/** Host HTTP bridge for browser-client RPC. */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-credentials'
// Activates the webServer Context merge used below.
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { API_PATH } from './api-path.ts'
import { CONNECT_PATH } from './connect-protocol.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority } from './api-request-trust.ts'
import { BrowserAuth } from './browser-auth.ts'
import { createAuthHandler, type AuthRouteKind } from './auth-routes.ts'
import { LoginThrottle } from './login-throttle.ts'
import { isUsableUsername, PasswordStore } from './password-record.ts'
import { HostConnectionService } from './rpc-host.ts'
import { ConnectionRecoveryConfigSchema, resolveConnectionConfig, type ConnectionRecoveryConfig } from './recovery-config.ts'

export type {
  PeerAdmission,
  ConnectionAdmission,
  ConnectionFetchMethod,
  ConnectionFetchHandler,
  ConnectionFetchRoute,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcAttachment,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRpcHandlerResult,
  ConnectionRequestRejection,
  ConnectionRpcResult,
  ConnectionRequestBodyMode,
  ConnectionTrustRequest,
  ClientRequest,
  HostConnectionHandle,
  HostConnectionFetch,
  HostConnectionRpc,
  RpcMessage,
  ServerResponse,
} from './rpc.ts'
export type { PeerId, PeerScope, Principal, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
export { RpcId, transportError } from './rpc.ts'
export { Peer } from './peer.ts'
export type { PeerOptions } from './peer.ts'
export { CONNECT_PATH, type ConnectionInteractions } from './connect-protocol.ts'
export {
  clientRequestSchema,
  rpcErrorSchema,
  rpcIdSchema,
  rpcMessageSchema,
  rpcResultSchema,
  serverResponseSchema,
} from './rpc-schema.ts'
export { HostConnectionService } from './rpc-host.ts'

export { API_PATH } from './api-path.ts'
export { LoginThrottle } from './login-throttle.ts'
export { PasswordStore } from './password-record.ts'
export { createAuthHandler, MAX_AUTH_REQUEST_BODY_BYTES, type AuthRouteDeps, type AuthRouteKind } from './auth-routes.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Path each browser authentication endpoint answers on. */
const AUTH_PATHS: Readonly<Record<AuthRouteKind, string>> = {
  login: '/auth/login',
  setup: '/auth/setup',
  logout: '/auth/logout',
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Admit or wrap an authenticated shared API request, including body transfer.
     * Existing requests continue when a listener refuses subsequent requests.
     * @param request - Authenticated incoming HTTP request.
     * @param response - Response owned until the delegated bridge settles.
     * @param next - Delegate to the next listener or the shared API bridge.
     * @mode waterfall
     */
    'connection/request'(request: IncomingMessage, response: ServerResponse, next: () => Promise<void>): Promise<void>
  }
}

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

/** Account name offered before a password record exists, and the only one accepted after. */
const DEFAULT_USERNAME = 'dsh'

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection. */
export const inject = ['credentials']

/** Browser authentication, request limits, and connection recovery configuration. */
export interface ConnectionConfig {
  /** Browser recovery timing, injected into each served page. */
  recovery?: ConnectionRecoveryConfig
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The fence accepts loopback and the
   * listener's own bind IP independently; other remote authorities require
   * an entry here. A non-canonical or non-bare authority fails plugin load.
   */
  trustedHosts?: string[]
  /**
   * Account name the browser sign-in page offers and requires. A password set
   * later keeps the name it was stored with, so this supplies the initial value
   * and the value a fresh setup form pre-fills. Default: `dsh`.
   */
  username?: string
  /** Absolute browser and API cookie lifetime in days. Default: 30. */
  cookieMaxAgeDays?: number
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  recovery: ConnectionRecoveryConfigSchema.default({}),
  trustedHosts: z.array(String).default([]),
  username: z.string().default(DEFAULT_USERNAME),
  cookieMaxAgeDays: z.natural().min(1).default(30),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Provides carrier-neutral RPC and Fetch registries. When `webServer` is
 * present, the plugin also mounts the `/api` browser transport, the `/auth`
 * password endpoints, and the `/connect` token exchange, each behind Host and
 * Origin checks.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export async function apply(ctx: Context, config?: ConnectionConfig): Promise<void> {
  const recovery = resolveConnectionConfig(config?.recovery)
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const username = config?.username ?? DEFAULT_USERNAME
  const cookieMaxAgeDays = config?.cookieMaxAgeDays ?? 30
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (!isUsableUsername(username)) {
    throw new Error(`client-connection: username ${JSON.stringify(username)} is not a usable account name`)
  }
  assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const passwords = new PasswordStore(ctx.credentials, username)
  // One await: the login record and the signing secret load together, so the
  // webServer injection below registers at the same point in activation as the
  // secret load alone.
  const [, auth] = await Promise.all([
    passwords.load(),
    BrowserAuth.create(ctx.root, ctx.credentials, cookieMaxAgeDays, passwords),
  ])
  const connection = new HostConnectionService(ctx, trustedHosts, auth)
  ctx.inject(['webServer'], (webCtx) => {
    assertImageBodyCapacity(webCtx, maxRequestBodyBytes)
    webCtx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: '__DSH_CONNECTION_RECOVERY__', value: recovery })
    })
    const fetchHandler = connection.createSharedFetchHandler(API_PATH)
    const route: WebRoute = {
      kind: 'prefix',
      path: API_PATH,
      handler: async (req, res) => {
        const admission = connection.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection)
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        await webCtx.waterfall('connection/request', req, res, () => bridge(req, res, fetchHandler, admission.peer, maxRequestBodyBytes))
      },
    }
    webCtx.effect(() => webCtx.webServer.register(route), 'client-connection: /api route')
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: CONNECT_PATH,
      handler: (req, res) => { connection.authorizeConnect(req, res) },
    }), 'client-connection: /connect route')
    const throttle = new LoginThrottle()
    const secure = (): boolean => webCtx.get('webServer')?.protocol === 'https:'
    const authDeps = {
      auth,
      passwords,
      throttle,
      reject: (request: Parameters<typeof connection.trustRejection>[0]) => connection.trustRejection(request),
      secure,
    }
    for (const kind of ['login', 'setup', 'logout'] as const) {
      const path = AUTH_PATHS[kind]
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact',
        path,
        handler: createAuthHandler(authDeps, kind),
      }), `client-connection: ${path} route`)
    }
  })
  ctx.inject(['attachments'], (attachmentCtx) => {
    assertImageBodyCapacity(attachmentCtx, maxRequestBodyBytes)
  })
}
