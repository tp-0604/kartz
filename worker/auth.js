/**
 * Who is asking, and what they may do.
 *
 * Everyone signs up: an in-game name, written plainly, and a password. A name belongs to one
 * account however it is capitalised or spaced, so "Amy" means one person everywhere and a board
 * sent by Amy is Amy's. An admin is an account that brought the admin code when it signed up —
 * a Worker secret, checked here and never trusted from the page.
 *
 * A signed-in browser holds a random token; the database holds only its hash, so a copy of the
 * database is not a way in. Passwords are PBKDF2-SHA256, salted, at the iteration count Workers
 * allow.
 */
import { HttpError, bad, now, str } from './util.js';

const NAME_RE = /^[A-Za-z0-9 _.'-]{2,24}$/;
const ITERATIONS = 100000;
const SESSION_DAYS = 180;
const enc = new TextEncoder();

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = buf => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = n => crypto.getRandomValues(new Uint8Array(n));
const sha256 = async text => b64(await crypto.subtle.digest('SHA-256', enc.encode(text)));

export const forbidden = message => new HttpError(403, message);

/** What "the same name" means: case and spacing do not make a second Amy. */
export const nameKey = raw => str(raw).replace(/\s+/g, ' ').toLowerCase();

/** An in-game name as it may be signed up with: plain letters, no fancy text. */
export function checkName(raw) {
  const name = str(raw).replace(/\s+/g, ' ');
  if (!name) throw bad('enter your in-game name.');
  if (!NAME_RE.test(name))
    throw bad("use plain letters, numbers, spaces and - _ . ' only — no fancy text — between 2 and 24 characters.");
  return name;
}

async function derive(password, saltB64) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), c => c.charCodeAt(0)) : random(16);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}

// Compared in constant time, so how long a refusal takes says nothing about how close a guess was.
function same(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export const publicUser = u => ({ id: u.id, name: u.name, role: u.role });

async function openSession(env, user) {
  const token = b64url(random(32));
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .bind(await sha256(token), user.id, now(), expires).run();
  return { token, user: publicUser(user) };
}

const taken = name => new HttpError(409, `“${name}” is already taken. If it is yours, sign in instead.`);

export async function signUp(env, body) {
  const name = checkName(body && body.name);
  const password = String((body && body.password) || '');
  if (password.length < 6) throw bad('choose a password of at least 6 characters.');
  if (password.length > 200) throw bad('that password is too long.');

  let role = 'member';
  if (body && body.admin) {
    if (!env.ADMIN_CODE)
      throw forbidden('admin sign-up is not set up on this Worker yet. Whoever runs it sets ADMIN_CODE.');
    if (!same(str(body.adminCode), env.ADMIN_CODE)) throw forbidden('that admin code is not right.');
    role = 'admin';
  }

  const key = nameKey(name);
  if (await env.DB.prepare('SELECT id FROM users WHERE name_key = ?').bind(key).first()) throw taken(name);
  const { hash, salt } = await derive(password);
  const user = { id: 'u_' + b64url(random(9)), name, role };
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, name, name_key, role, pass_hash, pass_salt, created_at, last_seen)
       VALUES (?,?,?,?,?,?,?,?)`)
      .bind(user.id, name, key, role, hash, salt, now(), now()).run();
  } catch {
    // Two sign-ups with one name at the same moment: the unique index decides, and the loser hears it.
    throw taken(name);
  }
  return openSession(env, user);
}

export async function signIn(env, body) {
  const key = nameKey(body && body.name);
  const password = String((body && body.password) || '');
  const user = key ? await env.DB.prepare('SELECT * FROM users WHERE name_key = ?').bind(key).first() : null;
  // One answer for a wrong name and a wrong password, so the form does not say which names exist.
  const refuse = () => new HttpError(401, 'that name and password do not match an account.');
  if (!user) { await derive(password || 'x'); throw refuse(); }
  const { hash } = await derive(password, user.pass_salt);
  if (!same(hash, user.pass_hash)) throw refuse();
  await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now(), user.id).run();
  return openSession(env, user);
}

export async function signOut(env, request) {
  const token = request.headers.get('x-kartz-session');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return { signedOut: true };
}

/** The signed-in account behind this request, or null. */
export async function who(env, request) {
  const token = request.headers.get('x-kartz-session');
  if (!token || token.length > 200) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`).bind(await sha256(token)).first();
  if (!row || row.expires_at < now()) return null;
  return { id: row.id, name: row.name, role: row.role };
}

export const isAdmin = user => !!user && user.role === 'admin';

/** An admin, or whoever sent this board. A board from before accounts is an admin's alone. */
export const mayManage = (user, board) =>
  isAdmin(user) || (!!user && !!board && !!board.created_by && board.created_by === user.id);

export function requireManage(user, board, what) {
  if (mayManage(user, board)) return;
  throw forbidden(board && board.created_by
    ? `only whoever sent this board, or an admin, can ${what} it.`
    : `this board is from before accounts, so only an admin can ${what} it.`);
}

export function requireAdmin(user, what) {
  if (!isAdmin(user)) throw forbidden(`only an admin can ${what}.`);
}
