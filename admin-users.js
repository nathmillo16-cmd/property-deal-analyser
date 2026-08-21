// admin-users.js — lists every Supabase auth user (paginated), used by
// GET /api/admin/users (server.js, Tier 1 roster) and weekly-digest.js so
// both read the full user list via the exact same pagination loop rather
// than two separate copies of it.
async function listAllAuthUsers(supabaseAdmin) {
  const users = [];
  let page = 1;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page++;
  }
  return users;
}

module.exports = { listAllAuthUsers };
