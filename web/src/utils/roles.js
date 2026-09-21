/**
 * What a role means, in one place.
 *
 * Kartz has one owner — whoever runs it — and they can do everything an admin can, so every
 * "is this an admin" question here answers yes for them too. The Worker decides all of this
 * (worker/auth.js); these are only for showing and hiding.
 */
export const isOwner = user => !!user && user.role === 'owner';
export const isAdmin = user => !!user && (user.role === 'admin' || user.role === 'owner');
export const roleLabel = user => (isOwner(user) ? 'owner' : isAdmin(user) ? 'admin' : 'member');
