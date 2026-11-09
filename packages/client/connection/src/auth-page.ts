/** Self-contained HTML for the browser sign-in and password setup page. */

import type { AuthMessages } from './auth-locale.ts'

/** Which form the page shows and which route answers it. */
export type AuthPageMode = 'sign-in' | 'set-password'

/** One page state: the form a mode shows and the control labels it carries. */
export interface PageCopy {
  /** Form and route this state posts to. */
  readonly mode: AuthPageMode
  /** Heading shown above the inputs. */
  readonly heading: string
  /** Submit button label. */
  readonly button: string
}

const STYLE = ':root{color-scheme:light dark;--fg:#16181d;--muted:#5b6270;--bg:#f6f7f9;'
  + '--card:#fff;--line:#d7dbe2;--accent:#2f6bff;--warn:#8a5300;--warn-bg:#fff5e0}'
  + '@media (prefers-color-scheme:dark){:root{--fg:#e8eaee;--muted:#9aa2b1;--bg:#14161a;'
  + '--card:#1d2026;--line:#31353d;--accent:#6f9bff;--warn:#ffd489;--warn-bg:#3a2f14}}'
  + '*{box-sizing:border-box}'
  + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
  + 'background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px}'
  + 'form{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px 26px}'
  + 'h1{margin:0 0 22px;font-size:19px;font-weight:600}'
  + 'label{display:block;margin:0 0 6px;color:var(--muted);font-size:13px}'
  + 'input{display:block;width:100%;margin:0 0 16px;padding:9px 11px;border:1px solid var(--line);'
  + 'border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}'
  + 'input:focus{outline:2px solid var(--accent);outline-offset:1px}'
  + 'button{width:100%;margin-top:4px;padding:10px;border:0;border-radius:8px;background:var(--accent);'
  + 'color:#fff;font:inherit;font-weight:600;cursor:pointer}'
  + 'button[disabled]{opacity:.6;cursor:default}'
  + 'p.note{margin:0 0 18px;padding:9px 11px;border-radius:8px;background:var(--warn-bg);color:var(--warn);font-size:13px}'
  + 'p.error{margin:0 0 16px;color:#c0392b;font-size:13px}'
  + '.pw{display:flex;gap:8px;margin:0 0 16px}'
  + '.pw input{margin:0}'
  + '.pw button{width:auto;margin:0;padding:0 12px;background:var(--card);border:1px solid var(--line);'
  + 'color:var(--muted);font-weight:400}'
  + 'label.check{display:flex;align-items:center;gap:8px;margin:0 0 18px;color:var(--fg);font-size:13px}'
  + 'label.check input{width:auto;margin:0}'

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
    ? { mode, heading: messages.setupTitle, button: messages.setupButton }
    : { mode, heading: messages.title, button: messages.signInButton }
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
    "var button=document.getElementById('b');",
    "function endpoint(){return state.mode==='set-password'?'auth/setup':'auth/login';}",
    "function say(text){box.textContent=text;box.hidden=false;}",
    "var pass=document.getElementById('p');",
    "document.getElementById('v').addEventListener('click',function(){",
    "pass.type=pass.type==='text'?'password':'text';pass.focus();});",
    "form.addEventListener('submit',function(event){",
    "event.preventDefault();box.hidden=true;button.disabled=true;",
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
    "button.disabled=false;",
    "if(outcome.status===200){location.replace('.');return;}",
    "var data=outcome.data;",
    "if(data&&data.copy){state=data.copy;document.getElementById('h').textContent=state.heading;",
    "button.textContent=state.button;form.action=endpoint();}",
    "var text=data&&data.message?data.message:" + JSON.stringify(messages.requestFailed) + ";",
    "if(data&&data.attemptsMessage){text=text+' '+data.attemptsMessage;}",
    "say(text);",
    "},function(){button.disabled=false;say(" + JSON.stringify(messages.requestFailed) + ");});",
    "});",
  ].join('')
  /* oxlint-enable @stylistic/quotes */
  return '<!doctype html>\n'
    + `<html lang=\"${messages.language}\">\n<head>\n<meta charset=\"utf-8\">\n`
    + '<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n'
    + '<meta name=\"referrer\" content=\"no-referrer\">\n'
    + `<title>${heading}</title>\n<style>${STYLE}</style>\n</head>\n`
    + '<body>\n<main>\n'
    + `<form id=\"f\" method=\"post\" action=\"${mode === 'set-password' ? 'auth/setup' : 'auth/login'}\" autocomplete=\"on\">\n`
    + `<h1 id=\"h\">${heading}</h1>\n`
    + (secure ? '' : `<p class=\"note\">${escapeText(messages.insecureNotice)}</p>\n`)
    + `<label for=\"u\">${escapeText(messages.usernameLabel)}</label>\n`
    + `<input id=\"u\" name=\"username\" value=\"${escapeText(accountName)}\" spellcheck=\"false\" required>\n`
    + `<label for=\"p\">${escapeText(messages.passwordLabel)}</label>\n`
    + '<div class=\"pw\">\n'
    + `<input id=\"p\" name=\"password\" type=\"password\" minlength=\"8\" maxlength=\"256\" autocomplete=\"${
      mode === 'set-password' ? 'new-password' : 'current-password'
    }\" required>\n`
    + `<button id=\"v\" type=\"button\" aria-label=\"${escapeText(messages.revealPassword)}\">◉</button>\n`
    + '</div>\n'
    + (mode === 'set-password'
      ? `<label for=\"c\">${escapeText(messages.confirmLabel)}</label>\n`
        + '<input id=\"c\" name=\"confirm\" type=\"password\" minlength=\"8\" maxlength=\"256\" autocomplete=\"new-password\" required>\n'
      : '')
    + `<label class=\"check\" for=\"r\"><input id=\"r\" name=\"remember\" type=\"checkbox\" checked>${escapeText(messages.rememberLabel)}</label>\n`
    + '<p class=\"error\" id=\"m\" role=\"alert\" hidden></p>\n'
    + `<button id=\"b\" type=\"submit\">${escapeText(copy.button)}</button>\n`
    + '</form>\n</main>\n'
    + `<script>${script}</script>\n</body>\n</html>\n`
}
