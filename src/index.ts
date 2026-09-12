import { getViews, incrementViews, getViewsBatch, cleanupDedup } from "./views";

export interface Env {
	D1: D1Database;
	VIEW_SALT: string;
	CORS_ORIGIN?: string;
}

const ROUTE_PATTERNS = {
	batch: /^\/api\/views\/batch$/,
	single: /^\/api\/views\/([^/]+)$/,
};

function addCorsHeaders(response: Response, origin: string): Response {
	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", origin);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const allowedOrigin = env.CORS_ORIGIN || "*";

		if (request.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": allowedOrigin,
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type",
				},
			});
		}

		try {
			if (!env.VIEW_SALT) {
				return addCorsHeaders(
					new Response(JSON.stringify({ error: "Server misconfigured" }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					}),
					allowedOrigin,
				);
			}

			const url = new URL(request.url);
			const path = url.pathname;
			let response: Response;

			if (path === "/api/views/batch" && request.method === "POST") {
				response = await getViewsBatch(request, env.D1);
			} else {
				const singleMatch = path.match(ROUTE_PATTERNS.single);
				if (singleMatch) {
					const slug = decodeURIComponent(singleMatch[1]);
					if (request.method === "GET") response = await getViews(slug, env.D1);
					else if (request.method === "POST") response = await incrementViews(slug, request, env);
					else response = new Response("Not Found", { status: 404 });
				} else {
					response = new Response("Not Found", { status: 404 });
				}
			}

			return addCorsHeaders(response, allowedOrigin);
		} catch (e) {
			return addCorsHeaders(
				new Response(JSON.stringify({ error: "Internal error" }), {
					status: 500,
					headers: { "Content-Type": "application/json" },
				}),
				allowedOrigin,
			);
		}
	},

	async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
		await cleanupDedup(env.D1);
	},
};
