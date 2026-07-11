// Social platform integration layer.
//
// Each adapter takes a connected account (with an accessToken obtained via that
// platform's OAuth) and returns a normalised snapshot:
//   { followers, posts, impressions, reach, engagement, clicks, spendUsd }
//
// IMPORTANT — every platform below requires YOUR OWN developer app:
//   • Facebook : Meta app + Page + Business verification + App Review.
//   • TikTok   : TikTok for Developers app + Login Kit/Display API approval.
//   • LinkedIn : app tied to your Company Page + Community Management API approval.
//   • X        : X developer account (pay-per-use; reading your own account is cheap).
//
// To go live for an account:
//   1. Create the developer app and complete the platform's review.
//   2. Run its OAuth flow to obtain an access token (and the page/org/user id).
//   3. Save them on the account:
//        PATCH /api/social/accounts/:id  { "accessToken": "...", "externalId": "<page/org/user id>" }
//   4. Press "Live sync" in the Social screen.
//
// Manual entry and CSV import work without any of this.

export const PLATFORMS = ["FACEBOOK", "INSTAGRAM", "X", "LINKEDIN", "YOUTUBE", "TIKTOK"];

const n = (v) => Number(v || 0);
const empty = { followers: 0, posts: 0, impressions: 0, reach: 0, engagement: 0, clicks: 0, spendUsd: 0 };

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.error_description || body?.message || text || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return body;
}

function notConfigured(platform) {
  const err = new Error(
    `Live sync for ${platform} needs your own developer app + access token. ` +
    `Add the token to the account, then sync. Manual entry and CSV import are available now.`
  );
  err.code = "NOT_CONFIGURED";
  return err;
}

// ── Facebook (Meta Graph API) ────────────────────────────────────────
// externalId = Facebook Page ID. accessToken = Page access token.
// Docs: https://developers.facebook.com/docs/graph-api/reference/page/insights
async function syncFacebook(a) {
  const ver = "v21.0";
  const id = a.externalId || a.handle;
  const base = `https://graph.facebook.com/${ver}/${encodeURIComponent(id)}`;
  const out = { ...empty };

  const profile = await getJson(`${base}?fields=followers_count,fan_count&access_token=${a.accessToken}`);
  out.followers = n(profile.followers_count || profile.fan_count);

  try {
    const ins = await getJson(
      `${base}/insights?metric=page_impressions,page_impressions_unique,page_post_engagements&period=day&access_token=${a.accessToken}`
    );
    for (const m of ins.data || []) {
      const latest = m.values?.[m.values.length - 1]?.value || 0;
      if (m.name === "page_impressions") out.impressions = n(latest);
      if (m.name === "page_impressions_unique") out.reach = n(latest);
      if (m.name === "page_post_engagements") out.engagement = n(latest);
    }
  } catch { /* insights need extra permissions; followers still returned */ }

  try {
    const posts = await getJson(`${base}/posts?summary=true&limit=0&access_token=${a.accessToken}`);
    out.posts = n(posts.summary?.total_count);
  } catch { /* optional */ }

  return out;
}

// ── TikTok (Display API) ─────────────────────────────────────────────
// accessToken = user access token (Login Kit). Scope: user.info.stats.
// Docs: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
async function syncTikTok(a) {
  const data = await getJson(
    "https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,likes_count,video_count",
    { Authorization: `Bearer ${a.accessToken}` }
  );
  const u = data?.data?.user || {};
  return { ...empty, followers: n(u.follower_count), posts: n(u.video_count), engagement: n(u.likes_count) };
}

// ── X (API v2) ───────────────────────────────────────────────────────
// accessToken = OAuth 2.0 user token. Reading your own account = cheap "owned reads".
// Docs: https://docs.x.com/x-api/users/user-lookup-me
async function syncX(a) {
  const data = await getJson(
    "https://api.x.com/2/users/me?user.fields=public_metrics",
    { Authorization: `Bearer ${a.accessToken}` }
  );
  const m = data?.data?.public_metrics || {};
  return { ...empty, followers: n(m.followers_count), posts: n(m.tweet_count) };
}

// ── LinkedIn (Marketing / Community Management API) ───────────────────
// externalId = organization id (numeric). accessToken = member token with
// r_organization_social / rw_organization_admin. Versioned via LinkedIn-Version.
// Docs: https://learn.microsoft.com/linkedin/marketing/community-management/organizations/organization-follower-statistics
async function syncLinkedIn(a) {
  const headers = {
    Authorization: `Bearer ${a.accessToken}`,
    "LinkedIn-Version": "202401",
    "X-Restli-Protocol-Version": "2.0.0",
  };
  const org = `urn:li:organization:${a.externalId}`;
  const out = { ...empty };

  const followers = await getJson(
    `https://api.linkedin.com/rest/networkSizes/${encodeURIComponent(org)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
    headers
  );
  out.followers = n(followers.firstDegreeSize);

  try {
    const stats = await getJson(
      `https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(org)}`,
      headers
    );
    const t = stats.elements?.[0]?.totalShareStatistics || {};
    out.impressions = n(t.impressionCount);
    out.clicks = n(t.clickCount);
    out.engagement = n(t.likeCount) + n(t.commentCount) + n(t.shareCount);
  } catch { /* share stats need elevated access */ }

  return out;
}

const ADAPTERS = {
  FACEBOOK: syncFacebook,
  TIKTOK: syncTikTok,
  X: syncX,
  LINKEDIN: syncLinkedIn,
  // INSTAGRAM / YOUTUBE: add adapters here when you connect those.
};

export async function syncAccount(account) {
  const adapter = ADAPTERS[account.platform];
  if (!adapter) throw notConfigured(account.platform);
  if (!account.accessToken) throw notConfigured(account.platform);
  try {
    return await adapter(account);
  } catch (e) {
    if (e.code === "NOT_CONFIGURED") throw e;
    const err = new Error(`${account.platform} sync failed: ${e.message}`);
    err.code = "SYNC_FAILED";
    throw err;
  }
}
