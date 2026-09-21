/**
 * Who is asking, and what they may do.
 *
 * Everyone signs up: an in-game name, written plainly, and a password. A name belongs to one
 * account however it is capitalised or spaced, so "Amy" means one person everywhere and a board
 * sent by Amy is Amy's. An admin is an account that brought the admin code when it signed up —
 * a Worker secret, checked here and never trusted from the page.
 *
 * Kartz has one owner: whoever runs it. They sign in like anybody else, but they brought the owner
 * code instead of the admin code, and they alone decide who else is an admin. Everything an admin
 * may do, the owner may do too.
 *
 * A signed-in browser holds a random token; the database holds only its hash, so a copy of the
 * database is not a way in. Passwords are PBKDF2-SHA256, salted, at the iteration count Workers
 * allow.
 */
import { HttpError, bad, logActivity, now, str } from './util.js';

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

async function noOwnerYet(env) {
  const owner = await env.DB.prepare("SELECT name FROM users WHERE role = 'owner'").first();
  if (owner)
    throw forbidden(`Kartz already has an owner — “${owner.name}”. Sign in as them, or ask them to hand it over.`);
}

const taken = name => new HttpError(409, `“${name}” is already taken. If it is yours, sign in instead.`);

export async function signUp(env, body) {
  const name = checkName(body && body.name);
  const password = String((body && body.password) || '');
  if (password.length < 6) throw bad('choose a password of at least 6 characters.');
  if (password.length > 200) throw bad('that password is too long.');

  // One box on the form, and the code decides which it is: the owner's code makes the owner,
  // the admin code makes an admin. Neither is ever checked anywhere but here.
  let role = 'member';
  if (body && body.admin) {
    const code = str(body.adminCode);
    if (!env.ADMIN_CODE && !env.OWNER_CODE)
      throw forbidden('admin sign-up is not set up on this Worker yet. Whoever runs it sets ADMIN_CODE.');
    if (env.OWNER_CODE && same(code, env.OWNER_CODE)) { await noOwnerYet(env); role = 'owner'; }
    else if (env.ADMIN_CODE && same(code, env.ADMIN_CODE)) role = 'admin';
    else throw forbidden('that admin code is not right.');
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

  // A code on the sign-in form claims the role for an account that already exists: how whoever
  // runs Kartz becomes the owner without signing up a second time under another name.
  const code = str(body && body.adminCode);
  if (code && user.role !== 'owner') {
    if (env.OWNER_CODE && same(code, env.OWNER_CODE)) {
      await noOwnerYet(env);
      await env.DB.prepare("UPDATE users SET role = 'owner' WHERE id = ?").bind(user.id).run();
      user.role = 'owner';
    } else if (env.ADMIN_CODE && same(code, env.ADMIN_CODE)) {
      if (user.role !== 'admin')
        await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
      user.role = 'admin';
    } else throw forbidden('that admin code is not right.');
  }

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

/** The one account that runs Kartz. There is never more than one. */
export const isOwner = user => !!user && user.role === 'owner';

/** Everything an admin may do, the owner may do as well. */
export const isAdmin = user => !!user && (user.role === 'admin' || user.role === 'owner');

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

export function requireOwner(user, what) {
  if (!isOwner(user)) throw forbidden(`only whoever owns Kartz can ${what}.`);
}

/** Everyone, with what they have sent — an admin reads this, the owner acts on it. */
export async function listUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.role, u.created_at, u.last_seen,
            (SELECT COUNT(*) FROM boards b WHERE b.created_by = u.id) AS boards
       FROM users u ORDER BY u.name_key`).all();
  return { users: results || [] };
}

async function target(env, actor, id, what, notYourself) {
  requireOwner(actor, what);
  const user = await env.DB.prepare('SELECT id, name, role FROM users WHERE id = ?').bind(str(id)).first();
  if (!user) throw new HttpError(404, 'no such account.');
  if (user.id === actor.id) throw bad(notYourself);
  return user;
}

/**
 * Who may do what. Making somebody else the owner hands Kartz over — there is one owner, so the
 * old one stays on as an admin. That is also the way back in if the owner ever loses the account.
 */
export async function setRole(env, actor, id, role) {
  const user = await target(env, actor, id, 'change what somebody may do',
                            'your own role is not yours to change. Hand Kartz over to somebody else instead.');
  if (!['member', 'admin', 'owner'].includes(role)) throw bad('a role is member, admin or owner.');
  if (user.role === role) return { user: publicUser(user) };

  if (role === 'owner') {
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET role = 'owner' WHERE id = ?").bind(user.id),
      env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(actor.id),
    ]);
    await logActivity(env, 'account', null, `handed Kartz over to ${user.name}`, { user: user.id, role });
    return { user: { id: user.id, name: user.name, role }, handedOver: true };
  }

  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, user.id).run();
  await logActivity(env, 'account', null,
    role === 'admin' ? `made ${user.name} an admin` : `made ${user.name} a member again`,
    { user: user.id, role });
  return { user: { id: user.id, name: user.name, role } };
}

/**
 * An account, gone: its sessions end at once. The boards it sent stay, with nobody's name on
 * them, which puts them back in an admin's hands until somebody is given them again.
 */
export async function removeUser(env, actor, id) {
  const user = await target(env, actor, id, 'remove an account',
                            'you cannot remove your own account.');
  const { count } = (await env.DB.prepare('SELECT COUNT(*) AS count FROM boards WHERE created_by = ?')
    .bind(user.id).first()) || { count: 0 };
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('UPDATE boards SET created_by = NULL WHERE created_by = ?').bind(user.id),
    env.DB.prepare('UPDATE extraction_runs SET created_by = NULL WHERE created_by = ?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  await logActivity(env, 'account', null, `removed the account ${user.name}`, { user: user.id, boards: count });
  return { removed: user.name, boards: count };
}
