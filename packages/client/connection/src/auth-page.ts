/** Self-contained HTML for the browser sign-in and password setup page. */

import type { AuthMessages } from './auth-locale.ts'
import { STAGE_MARKUP, STAGE_SCRIPT } from './auth-stage.ts'

/** Which form the page shows and which route answers it. */
export type AuthPageMode = 'sign-in' | 'set-password'

/** One page state: the form a mode shows and the copy its controls carry. */
export interface PageCopy {
  /** Form and route this state posts to. */
  readonly mode: AuthPageMode
  /** Heading shown above the inputs. */
  readonly heading: string
  /** Line under the heading, naming what this form is for. */
  readonly subtitle: string
  /** Submit button label. */
  readonly button: string
}

/** Page chrome for the sign-in screen: palette, layout, and control styling, shipped inline. */
const STYLE = `
:root{color-scheme:light dark;--fg:#14171d;--muted:#5c6473;--bg:#eef1f6;--card:#fff;--line:#e2e6ec;
  --edge:#ccd3de;--accent:#2f6bff;--accent-strong:#2455d4;--accent-soft:#e9f0ff;
  --danger:#b3261e;--danger-bg:#fdf1f0;--danger-line:#f4cdc9;--warn:#8a5300;--warn-bg:#fff6e6;
  --warn-line:#f0dfbc;--stage-base:#f7f9ff;--stage-a:#d9e6ff;--stage-b:#e8f0ff;
  --ring:0 0 0 4px rgba(47,107,255,.18);--lift:0 1px 2px rgba(16,24,40,.05),0 26px 60px -26px rgba(16,24,40,.32)}
@media (prefers-color-scheme:dark){:root{--fg:#e7eaef;--muted:#9aa4b3;--bg:#0c0f14;--card:#171b23;
  --line:#282e39;--edge:#3b4351;--accent:#5b8cff;--accent-strong:#3f6fe0;--accent-soft:#1e2a44;
  --danger:#f4a49c;--danger-bg:#3a2321;--danger-line:#5e322e;--warn:#f5cf8e;--warn-bg:#3a2f16;
  --warn-line:#5b4a24;--stage-base:#101725;--stage-a:#1d2f55;--stage-b:#14213f;
  --ring:0 0 0 4px rgba(91,140,255,.22);--lift:0 1px 2px rgba(0,0,0,.4),0 26px 60px -26px rgba(0,0,0,.75)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;
  background:radial-gradient(120% 80% at 50% 0,var(--stage-b),transparent 60%),var(--bg);color:var(--fg);
  font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.layout{display:grid;grid-template-columns:1.05fr .95fr;width:min(1040px,100%);min-height:min(600px,86vh);
  background:var(--card);border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:var(--lift)}
.stage{position:relative;overflow:hidden;border-right:1px solid var(--line);cursor:pointer;
  background:radial-gradient(120% 90% at 12% 6%,var(--stage-a),transparent 62%),
    radial-gradient(110% 120% at 92% 96%,var(--stage-b),transparent 58%),var(--stage-base)}
.stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.stage-fish{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:56%;height:auto;
  fill:currentColor;color:var(--accent);opacity:.16}
.pane{display:flex;align-items:center;justify-content:center;padding:44px 46px}
.card{width:100%;max-width:332px}
h1{margin:0 0 6px;font-size:22px;font-weight:650;letter-spacing:-.02em}
p.sub{margin:0 0 24px;color:var(--muted);font-size:13.5px;line-height:1.5}
label{display:block;margin:0 0 6px;font-size:12.5px;font-weight:550;color:var(--muted)}
input:not([type=checkbox]){display:block;width:100%;padding:11px 12px;margin:0 0 16px;border:1px solid var(--edge);
  border-radius:10px;background:var(--card);color:var(--fg);font:inherit;font-size:15px;
  transition:border-color .15s ease,box-shadow .15s ease}
input:not([type=checkbox]):focus{outline:none;border-color:var(--accent);box-shadow:var(--ring)}
.pw{position:relative;margin:0 0 16px}
.pw input{margin:0;padding-right:46px}
.pw button{position:absolute;top:1px;right:1px;width:40px;height:calc(100% - 2px);display:flex;align-items:center;
  justify-content:center;padding:0;border:0;border-radius:0 9px 9px 0;background:none;color:var(--muted);
  cursor:pointer;transition:color .15s ease,background .15s ease}
.pw button:hover{color:var(--accent);background:var(--accent-soft)}
.pw button:focus-visible{outline:none;box-shadow:var(--ring);border-radius:9px}
label.check{display:flex;align-items:center;gap:9px;margin:0 0 20px;font-size:13px;font-weight:400;
  color:var(--fg);cursor:pointer}
label.check input{width:16px;height:16px;margin:0;flex:0 0 auto;accent-color:var(--accent);cursor:pointer}
button[type=submit]{width:100%;display:flex;align-items:center;justify-content:center;gap:9px;padding:12px;border:0;
  border-radius:10px;background:linear-gradient(180deg,var(--accent),var(--accent-strong));color:#fff;font:inherit;
  font-size:15px;font-weight:600;letter-spacing:.01em;cursor:pointer;box-shadow:0 8px 20px -10px rgba(47,107,255,.75);
  transition:filter .15s ease,transform .08s ease,box-shadow .15s ease}
button[type=submit]:hover{filter:brightness(1.05)}
button[type=submit]:active{transform:translateY(1px)}
button[type=submit]:focus-visible{outline:none;box-shadow:var(--ring)}
button[type=submit][disabled]{cursor:progress;filter:none;opacity:.82;transform:none}
.spinner{width:15px;height:15px;flex:0 0 auto;border-radius:50%;border:2px solid rgba(255,255,255,.35);
  border-top-color:#fff;animation:spin .7s linear infinite}
.spinner[hidden]{display:none}
@keyframes spin{to{transform:rotate(360deg)}}
p.note,p.error{display:flex;align-items:flex-start;gap:9px;margin:0 0 18px;padding:10px 12px;border-radius:10px;
  font-size:12.5px;line-height:1.45;border:1px solid transparent}
p.note{background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn)}
p.error{background:var(--danger-bg);border-color:var(--danger-line);color:var(--danger)}
p.error[hidden]{display:none}
p.note svg,p.error svg{flex:0 0 auto;margin-top:1px}
@media (max-width:880px){.layout{grid-template-columns:1fr;min-height:0}
  .stage{height:224px;border-right:0;border-bottom:1px solid var(--line)}
  .pane{padding:30px 26px 34px}}
@media (max-width:430px){body{padding:14px}.stage{height:186px}.pane{padding:24px 20px 28px}
  .card{max-width:none}h1{font-size:20px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`

/** Outline eye shown on the control that reveals a secret field. */
const EYE = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 3.4C4.7 3.4 2.4 6.5 1.6 8c.8 1.5 3.1 4.6 6.4 4.6s5.6-3.1 6.4-4.6C13.6 6.5 11.3 3.4 8 3.4Zm0 7.5A2.9 2.9 0 1 1 8 5.1a2.9 2.9 0 0 1 0 5.8Z"/></svg>'

/** Triangle with an exclamation, shown on the plain-HTTP notice. */
const WARNING = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.7 15 14.2H1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6v3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.5" r=".8" fill="currentColor"/></svg>'

/** Circle with an exclamation, shown on a refused attempt. */
const ALERT = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5v4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.2" r=".9" fill="currentColor"/></svg>'

/**
 * Escape text for an HTML text node or a quoted attribute value.
 * @param value - text to place in the document.
 * @returns the escaped text.
 */
function escapeText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

/**
 * Describe the form one mode shows.
 * @param messages - copy in the browser's language.
 * @param mode - `set-password` while no password record exists, otherwise `sign-in`.
 * @returns the labels a page or a JSON reply carries.
 */
export function pageCopy(messages: AuthMessages, mode: AuthPageMode): PageCopy {
  return mode === 'set-password'
    ? { mode, heading: messages.setupTitle, subtitle: messages.setupSubtitle, button: messages.setupButton }
    : { mode, heading: messages.title, subtitle: messages.subtitle, button: messages.signInButton }
}

/**
 * Render the sign-in page, or the setup page while no password exists.
 * @param messages - copy selected from the browser request language.
 * @param mode - form the page shows.
 * @param accountName - account name offered as the input default.
 * @param secure - whether the answering listener serves TLS; plain HTTP warns.
 * @returns a complete document that loads no external resource.
 */
export function renderAuthPage(
  messages: AuthMessages,
  mode: AuthPageMode,
  accountName: string,
  secure: boolean,
): string {
  const copy = pageCopy(messages, mode)
  const heading = escapeText(copy.heading)
  /* oxlint-disable @stylistic/quotes -- each line embeds double-quoted HTML and single-quoted JS literals. */
  const script = [
    "var state=" + JSON.stringify(copy) + ";",
    "var form=document.getElementById('f');",
    "var box=document.getElementById('m');",
    "var msg=document.getElementById('mt');",
    "var button=document.getElementById('b');",
    "var label=document.getElementById('bt');",
    "var spinner=document.getElementById('sp');",
    "var BUSY=" + JSON.stringify(messages.signingIn) + ";",
    "function endpoint(){return state.mode==='set-password'?'auth/setup':'auth/login';}",
    "function say(text){box.hidden=false;msg.textContent=text;}",
    "function busy(on){button.disabled=on;spinner.hidden=!on;label.textContent=on?BUSY:state.button;",
    "button.setAttribute('aria-busy',String(on));}",
    "function reveal(btn,id){var input=document.getElementById(id);btn.addEventListener('click',function(){",
    "var shown=input.type==='text';input.type=shown?'password':'text';",
    "btn.setAttribute('aria-pressed',String(!shown));if(!shown){input.focus();}});}",
    "reveal(document.getElementById('v'),'p');",
    "var eye=document.getElementById('vc');if(eye){reveal(eye,'c');}",
    "form.addEventListener('submit',function(event){",
    "event.preventDefault();box.hidden=true;busy(true);",
    "var fields={username:document.getElementById('u').value,",
    "password:document.getElementById('p').value,",
    "remember:document.getElementById('r').checked};",
    "var again=document.getElementById('c');",
    "if(again){fields.confirmPassword=again.value;}",
    "var body=JSON.stringify(fields);",
    "fetch(endpoint(),{method:'POST',headers:{'content-type':'application/json'},",
    "body:body,credentials:'same-origin'}).then(function(response){",
    "return response.json().catch(function(){return null;})",
    ".then(function(data){return {status:response.status,data:data};});",
    "}).then(function(outcome){",
    "var data=outcome.data;",
    "if(outcome.status===200){busy(false);location.replace('.');return;}",
    "if(data&&data.copy){state=data.copy;document.getElementById('h').textContent=state.heading;",
    "document.getElementById('s').textContent=state.subtitle;form.action=endpoint();}",
    "busy(false);",
    "var text=data&&data.message?data.message:" + JSON.stringify(messages.requestFailed) + ";",
    "if(data&&data.attemptsMessage){text=text+' '+data.attemptsMessage;}",
    "say(text);",
    "},function(){busy(false);say(" + JSON.stringify(messages.requestFailed) + ");});",
    "});",
  ].join('')
  /* oxlint-enable @stylistic/quotes */
  return '<!doctype html>\n'
    + `<html lang="${messages.language}">\n<head>\n<meta charset="utf-8">\n`
    + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + '<meta name="referrer" content="no-referrer">\n'
    + `<title>${heading}</title>\n<style>${STYLE}</style>\n</head>\n`
    + `<body>\n<main class="layout">\n<section class="stage">${STAGE_MARKUP}</section>\n`
    + '<section class="pane">\n<div class="card">\n'
    + `<h1 id="h">${heading}</h1>\n<p class="sub" id="s">${escapeText(copy.subtitle)}</p>\n`
    + (secure ? '' : `<p class="note">${WARNING}<span>${escapeText(messages.insecureNotice)}</span></p>\n`)
    + `<form id="f" method="post" action="${mode === 'set-password' ? 'auth/setup' : 'auth/login'}" autocomplete="on">\n`
    + `<label for="u">${escapeText(messages.usernameLabel)}</label>\n`
    + `<input id="u" name="username" value="${escapeText(accountName)}" spellcheck="false" required>\n`
    + `<label for="p">${escapeText(messages.passwordLabel)}</label>\n`
    + '<div class="pw">\n'
    + `<input id="p" name="password" type="password" minlength="8" maxlength="256" autocomplete="${
      mode === 'set-password' ? 'new-password' : 'current-password'
    }" required>\n`
    + `<button id="v" type="button" aria-label="${escapeText(messages.revealPassword)}" aria-pressed="false">${EYE}</button>\n`
    + '</div>\n'
    + (mode === 'set-password'
      ? `<label for="c">${escapeText(messages.confirmLabel)}</label>\n<div class="pw">\n`
        + '<input id="c" name="confirm" type="password" minlength="8" maxlength="256" autocomplete="new-password" required>\n'
        + `<button id="vc" type="button" aria-label="${escapeText(messages.revealPassword)}" aria-pressed="false">${EYE}</button>\n</div>\n`
      : '')
    + `<label class="check" for="r"><input id="r" name="remember" type="checkbox" checked>${escapeText(messages.rememberLabel)}</label>\n`
    + `<p class="error" id="m" role="alert" hidden>${ALERT}<span id="mt"></span></p>\n`
    + `<button id="b" type="submit"><span class="spinner" id="sp" hidden></span><span id="bt">${escapeText(copy.button)}</span></button>\n`
    + '</form>\n</div>\n</section>\n</main>\n'
    + `<script>${STAGE_SCRIPT}</script>\n<script>${script}</script>\n</body>\n</html>\n`
}
