import { deriveAccent } from '@/lib/color';
import { EMAIL_TOKENS, normalizeHex } from './colors';
import { PLATFORM_NAME } from './platform';
import { httpUrl } from './text';

/**
 * The one layout of every e-mail the platform sends: a card on a grey page, topped by a bar in
 * the colour of what it is about, the BDE's logo and name, a heading, the facts as rows, one
 * button, and a discreet footer. It is a pure function of a model: what each e-mail says lives
 * next to it (events/email.ts, members/email.ts).
 *
 * Built for the least capable mail clients, not for browsers: tables for the structure, inline styles
 * for everything that matters (Gmail may drop a `<style>`), `bgcolor` attributes, a VML button for
 * Outlook on the desktop (which renders with Word), a hidden preheader, and a `<style>` that only
 * adds what a client may or may not honour (dark mode, narrow screens). Every text and address
 * that goes in is escaped here, once, so that nothing a member typed can become markup.
 */

export interface EmailField {
  label: string;
  value: string;
  /** A colour shown as a dot before the value (the colour of a category). */
  marker?: string;
}

export interface EmailModel {
  /** `fr` or `en`: the language of the e-mail, for screen readers and hyphenation. */
  lang: string;
  preheader: string;
  /** The BDE: its name, its logo when a client can load it, and its colour (which colours the button, as everywhere on the platform). */
  brand: { name: string; logoUrl?: string; accent?: string };
  /** The colour of the bar, a hex colour: the category of an event, the kind of a member notification. */
  accent: string;
  /** Small line above the heading: what kind of message this is. */
  eyebrow: string;
  heading: string;
  /** A paragraph under the heading. New lines are kept. */
  lead?: string;
  /** A person's picture, above the heading (the member a message is about). */
  avatarUrl?: string;
  fields: EmailField[];
  action?: { label: string; url: string };
  /** A small sentence under the button. */
  note?: string;
  footer: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const LIGHT = {
  page: EMAIL_TOKENS.light.page,
  card: EMAIL_TOKENS.light.card,
  text: EMAIL_TOKENS.light.ink,
  muted: EMAIL_TOKENS.light.muted,
  rule: EMAIL_TOKENS.light.line,
};
const DARK = EMAIL_TOKENS.dark;

/** The corners of the card and of the logo, and the pill of the button: the radii of the interface. */
const RADIUS = { card: 24, logo: 12 };

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text for an HTML body or an attribute: nothing a member typed can open a tag or close a quote. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Text with its line breaks kept, escaped. */
function multiline(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
}

/** Characters that push the body text out of the inbox preview, after the preheader. */
const PREHEADER_FILLER = '&#847;&zwnj;&nbsp;'.repeat(60);

/** Rough width of the Outlook button, which cannot size itself to its label. */
const outlookButtonWidth = (label: string) => Math.min(420, Math.max(190, label.length * 10 + 64));

function styles(): string {
  return `
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0;mso-table-rspace:0}
    img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}
    a{color:inherit}
    @media (max-width:620px){
      .px{padding-left:20px!important;padding-right:20px!important}
      .h1{font-size:24px!important;line-height:30px!important}
      .stack{display:block!important;width:100%!important;padding-left:0!important;padding-right:0!important}
      .label{padding-bottom:0!important}
      .value{padding-top:2px!important;border-top:0!important}
      .btn{display:block!important;text-align:center!important}
    }
    @media (prefers-color-scheme:dark){
      .bg-page{background-color:${DARK.page}!important}
      .bg-card{background-color:${DARK.card}!important}
      .t-main{color:${DARK.ink}!important}
      .t-muted{color:${DARK.muted}!important}
      .rule{border-color:${DARK.line}!important}
      .logo{border:1px solid #6b7385!important}
    }
    [data-ogsc] .t-main{color:${DARK.ink}!important}
    [data-ogsc] .t-muted{color:${DARK.muted}!important}
    [data-ogsb] .bg-page{background-color:${DARK.page}!important}
    [data-ogsb] .bg-card{background-color:${DARK.card}!important}
    [data-ogsb] .rule{border-color:${DARK.line}!important}
    [data-ogsc] .logo{border:1px solid #6b7385!important}`;
}

function logoHtml(brand: EmailModel['brand']): string {
  const name = escapeHtml(brand.name);
  const logoUrl = httpUrl(brand.logoUrl);
  const nameCell = `<td class="t-main" style="font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:${LIGHT.text};padding-left:${logoUrl ? 12 : 0}px" valign="middle">${name}</td>`;
  const logoCell = logoUrl
    ? `<td valign="middle" width="40" style="width:40px"><img class="logo" src="${escapeHtml(logoUrl)}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:${RADIUS.logo}px"></td>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logoCell}${nameCell}</tr></table>`;
}

function fieldRows(fields: EmailField[]): string {
  const rows = fields.map((field, index) => {
    const border = index === 0 ? '' : `border-top:1px solid ${LIGHT.rule};`;
    const marker = field.marker
      ? `<span style="color:${normalizeHex(field.marker)}">&#9679;</span>&nbsp;`
      : '';
    return `<tr>
<td class="stack label t-muted rule" width="130" valign="top" style="${border}width:130px;padding:12px 12px 12px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${LIGHT.muted}">${escapeHtml(field.label)}</td>
<td class="stack value t-main rule" valign="top" style="${border}padding:12px 0;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${LIGHT.text}">${marker}${multiline(field.value)}</td>
</tr>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px">${rows.join('\n')}</table>`;
}

/**
 * The button: a pill in the colour of the BDE, worked out as on the platform (`deriveAccent`: kept when white or near-black text
 * reads on it at 4.5:1, darkened until white does), never the colour of the bar, which says what the message is about.
 */
function buttonHtml(action: { label: string; url: string }, brandAccent: string): string {
  const url = escapeHtml(httpUrl(action.url) ?? '');
  const label = escapeHtml(action.label);
  const { fill, on } = deriveAccent(brandAccent, 'light');
  const color = on.toLowerCase();
  const accent = fill.toLowerCase();
  const width = outlookButtonWidth(action.label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px"><tr><td align="center" bgcolor="${accent}" style="background-color:${accent};border-radius:999px">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" arcsize="50%" stroke="f" fillcolor="${accent}" style="height:46px;v-text-anchor:middle;width:${width}px"><w:anchorlock/><center style="font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:${color}">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a class="btn" href="${url}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:700;line-height:20px;color:${color};text-decoration:none;border-radius:999px;background-color:${accent}">${label}</a><!--<![endif]-->
</td></tr></table>`;
}

/** The e-mail as HTML (for every client) and as text (for those that show only text). */
export function renderEmail(model: EmailModel): RenderedEmail {
  const accent = normalizeHex(model.accent);
  // The button is the BDE's colour; a message with no brand colour (a test) falls back on the bar's.
  const buttonAccent = normalizeHex(model.brand.accent ?? model.accent);
  const avatarUrl = httpUrl(model.avatarUrl);
  const action = model.action && httpUrl(model.action.url) ? model.action : undefined;

  const html = `<!doctype html>
<html lang="${escapeHtml(model.lang)}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(model.heading)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><style>table,td{font-family:Arial,sans-serif}</style><![endif]-->
<style>${styles()}
</style>
</head>
<body class="bg-page" bgcolor="${LIGHT.page}" style="margin:0;padding:0;width:100%;background-color:${LIGHT.page}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(model.preheader)}${PREHEADER_FILLER}</div>
<table role="presentation" class="bg-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIGHT.page}" style="background-color:${LIGHT.page}"><tr><td align="center" style="padding:28px 12px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="bg-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIGHT.card}" style="max-width:600px;background-color:${LIGHT.card};border-radius:${RADIUS.card}px">
<tr><td bgcolor="${accent}" height="6" style="height:6px;line-height:6px;font-size:6px;background-color:${accent};border-radius:${RADIUS.card}px ${RADIUS.card}px 0 0">&nbsp;</td></tr>
<tr><td class="px" style="padding:26px 36px 0">${logoHtml(model.brand)}</td></tr>
<tr><td class="px" style="padding:26px 36px 0">
${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:32px;margin-bottom:16px">` : ''}
<div class="t-muted" style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${LIGHT.muted}">${escapeHtml(model.eyebrow)}</div>
<h1 class="h1 t-main" style="margin:8px 0 0;font-family:${FONT};font-size:26px;line-height:32px;font-weight:800;color:${LIGHT.text}">${escapeHtml(model.heading)}</h1>
${model.lead ? `<p class="t-main" style="margin:14px 0 0;font-family:${FONT};font-size:15px;line-height:23px;color:${LIGHT.text}">${multiline(model.lead)}</p>` : ''}
${model.fields.length > 0 ? fieldRows(model.fields) : ''}
${action ? buttonHtml(action, buttonAccent) : ''}
${model.note ? `<p class="t-muted" style="margin:16px 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:${LIGHT.muted}">${multiline(model.note)}</p>` : ''}
</td></tr>
<tr><td class="px" style="padding:30px 36px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="rule t-muted" style="border-top:1px solid ${LIGHT.rule};padding-top:16px;font-family:${FONT};font-size:12px;line-height:18px;color:${LIGHT.muted}">${multiline(model.footer)}<br>${escapeHtml(PLATFORM_NAME)}</td></tr></table></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`;

  const text = [
    model.brand.name,
    model.eyebrow.toUpperCase(),
    '',
    model.heading,
    ...(model.lead ? ['', model.lead] : []),
    ...(model.fields.length > 0
      ? ['', ...model.fields.map((field) => `${field.label} : ${field.value}`)]
      : []),
    ...(action ? ['', `${action.label} : ${action.url}`] : []),
    ...(model.note ? ['', model.note] : []),
    '',
    '--',
    model.footer,
    PLATFORM_NAME,
    '',
  ].join('\n');

  return { html, text };
}
