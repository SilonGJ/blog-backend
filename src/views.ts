const SLUG_REGEX = /^[a-zA-Z0-9\-\/]+$/;
const MAX_BATCH_SIZE = 50;
const DEDUP_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

interface Env {
	D1: D1Database;
	VIEW_SALT: string;
}

async function computeHash(slug: string, ip: string, ua: string, salt: string): Promise<string> {
	const data = `${slug}|${ip}|${ua}|${salt}`;
	const encoder = new TextEncoder();
	const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
	const hashArray = new Uint8Array(hashBuffer);
	return Array.from(hashArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.substring(0, 16);
}

function validateSlug(slug: string): boolean {
	return slug.length > 0 && slug.length <= 256 && SLUG_REGEX.test(slug);
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

export async function getViews(slug: string, d1: D1Database): Promise<Response> {
	if (!validateSlug(slug)) return json({ error: "Invalid slug" }, 400);

	const row = await d1.prepare("SELECT count FROM article_views WHERE slug = ?").bind(slug).first<{ count: number }>();
	return json({ count: row?.count ?? 0 });
}

export async function incrementViews(slug: string, request: Request, env: Env): Promise<Response> {
	if (!validateSlug(slug)) return json({ error: "Invalid slug" }, 400);

	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const ua = request.headers.get("User-Agent") ?? "unknown";
	const hash = await computeHash(slug, ip, ua, env.VIEW_SALT);
	const now = Math.floor(Date.now() / 1000);

	const results = await env.D1.batch([
		env.D1.prepare("INSERT OR IGNORE INTO view_dedup (hash, slug, created_at) VALUES (?, ?, ?)").bind(hash, slug, now),
		env.D1.prepare(
			`INSERT INTO article_views (slug, count) VALUES (?, 1)
			 ON CONFLICT(slug) DO UPDATE SET count = count + 1, updated_at = CURRENT_TIMESTAMP
			 WHERE (SELECT changes()) > 0`,
		).bind(slug),
		env.D1.prepare("SELECT count FROM article_views WHERE slug = ?").bind(slug),
	]);

	const row = (results[2]?.results as any)?.[0];
	return json({ count: row?.count ?? 1 });
}

export async function getViewsBatch(request: Request, d1: D1Database): Promise<Response> {
	const body = (await request.json()) as { slugs?: string[] };
	const slugs = body.slugs;

	if (!Array.isArray(slugs) || slugs.length === 0) return json({ data: {} });
	if (slugs.length > MAX_BATCH_SIZE) return json({ error: `Max ${MAX_BATCH_SIZE} slugs` }, 400);

	const validSlugs = slugs.filter(validateSlug);
	if (validSlugs.length === 0) return json({ data: {} });

	const placeholders = validSlugs.map(() => "?").join(",");
	const { results } = await d1.prepare(`SELECT slug, count FROM article_views WHERE slug IN (${placeholders})`)
		.bind(...validSlugs)
		.all<{ slug: string; count: number }>();

	const data: Record<string, number> = {};
	for (const slug of validSlugs) data[slug] = 0;
	for (const row of results ?? []) data[row.slug] = row.count;

	return json({ data });
}

export async function cleanupDedup(d1: D1Database): Promise<void> {
	const cutoff = Math.floor(Date.now() / 1000) - DEDUP_TTL;
	await d1.prepare("DELETE FROM view_dedup WHERE created_at < ?").bind(cutoff).run();
}
