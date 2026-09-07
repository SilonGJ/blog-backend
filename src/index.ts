import { getViews, incrementViews, getViewsBatch, cleanupDedup } from "./views";

export interface Env {
	D1: D1Database;
	VIEW_SALT: string;
}

const ROUTE_PATTERNS = {
	batch: /^\/api\/views\/batch$/,
	single: /^\/api\/views\/([^/]+)$/,
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		try {
			if (request.method === "OPTIONS") {
				return new Response(null, {
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type",
					},
				});
			}

			if (!env.VIEW_SALT) {
				return new Response(JSON.stringify({ error: "Server misconfigured" }), {
					status: 500,
					headers: { "Content-Type": "application/json" },
				});
			}

			const url = new URL(request.url);
			const path = url.pathname;

			if (path === "/api/views/batch" && request.method === "POST") {
				return getViewsBatch(request, env.D1);
			}

			const singleMatch = path.match(ROUTE_PATTERNS.single);
			if (singleMatch) {
				const slug = decodeURIComponent(singleMatch[1]);
				if (request.method === "GET") return getViews(slug, env.D1);
				if (request.method === "POST") return incrementViews(slug, request, env);
			}

			return new Response("Not Found", { status: 404 });
		} catch (e) {
			return new Response(JSON.stringify({ error: "Internal error" }), {
				status: 500,
				headers: { "Content-Type": "application/json" },
			});
		}
	},

	async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
		await cleanupDedup(env.D1);
	},
};
