import path from "node:path";
import {
  authorTurnRequest,
  checkRequest,
  createDocumentRequest,
  createThreadRequest,
  insightRequest,
  proposalDecisionRequest,
  saveDocumentRequest,
  threadDecisionRequest,
  type StudioConfig,
} from "../../shared/schemas.ts";
import { createRouter, readJsonBody, requireQuery, sendJson } from "../http.ts";
import type { AiAdapter } from "../providers/ai-adapter.ts";
import type { DocumentService } from "../services/documents.ts";
import type { createHarnessService } from "../services/harness.ts";
import type { ThreadService } from "../services/threads.ts";

export function createApiRouter({
  root,
  dataLocation,
  adapter,
  adapterReason,
  documents,
  threads,
  harness,
}: {
  root: string;
  dataLocation: string;
  adapter: AiAdapter | null;
  adapterReason?: string;
  documents: DocumentService;
  threads: ThreadService;
  harness: ReturnType<typeof createHarnessService>;
}) {
  const router = createRouter();

  router.add("GET", "/api/config", async ({ response }) => {
    // APIキーなどの秘密値は返さない。
    const config: StudioConfig = {
      workspaceName: path.basename(root),
      ai: adapter
        ? { configured: true, provider: adapter.provider, model: adapter.model }
        : { configured: false, provider: null, model: null, reason: adapterReason ?? "AIが設定されていません" },
      harness: harness.availability,
      dataLocation,
    };
    sendJson(response, 200, config);
  });

  router.add("GET", "/api/documents", async ({ response }) => {
    sendJson(response, 200, { documents: await documents.list() });
  });

  router.add("POST", "/api/documents", async ({ request, response }) => {
    const body = await readJsonBody(request, createDocumentRequest);
    sendJson(response, 201, await documents.create(body.path, body.content ?? ""));
  });

  router.add("GET", "/api/document", async ({ response, query }) => {
    sendJson(response, 200, await documents.read(requireQuery(query, "path")));
  });

  router.add("PUT", "/api/document", async ({ request, response }) => {
    const body = await readJsonBody(request, saveDocumentRequest);
    sendJson(response, 200, await documents.save(body.path, body.content, body.expectedHash));
  });

  router.add("GET", "/api/threads", async ({ response, query }) => {
    sendJson(response, 200, { threads: await threads.list(requireQuery(query, "path")) });
  });

  router.add("POST", "/api/threads", async ({ request, response }) => {
    const body = await readJsonBody(request, createThreadRequest);
    sendJson(response, 201, await threads.create(body.path, body.anchor, body.mode));
  });

  router.add("POST", "/api/threads/:id/assist", async ({ response, params }) => {
    sendJson(response, 200, await threads.assist(params.id ?? ""));
  });

  // クライアントが追加できる発言は書き手（author）のものだけ。
  router.add("POST", "/api/threads/:id/turns", async ({ request, response, params }) => {
    const body = await readJsonBody(request, authorTurnRequest);
    sendJson(response, 201, await threads.addAuthorTurn(params.id ?? "", body.text));
  });

  router.add("POST", "/api/threads/:id/decision", async ({ request, response, params }) => {
    const body = await readJsonBody(request, threadDecisionRequest);
    sendJson(response, 200, await threads.decide(params.id ?? "", body.decision));
  });

  router.add("POST", "/api/threads/:id/insights", async ({ request, response, params }) => {
    const body = await readJsonBody(request, insightRequest);
    sendJson(response, 201, await threads.addInsight(params.id ?? "", body.text));
  });

  router.add("POST", "/api/threads/:id/proposals", async ({ response, params }) => {
    sendJson(response, 201, await threads.propose(params.id ?? ""));
  });

  router.add("POST", "/api/proposals/:id/decision", async ({ request, response, params }) => {
    const body = await readJsonBody(request, proposalDecisionRequest);
    sendJson(response, 200, await threads.decideProposal(params.id ?? "", body.decision, body.expectedHash));
  });

  router.add("POST", "/api/check", async ({ request, response }) => {
    const body = await readJsonBody(request, checkRequest);
    sendJson(response, 200, await harness.check(body.path));
  });

  router.add("GET", "/api/contract", async ({ response, query }) => {
    sendJson(response, 200, await harness.contract(requireQuery(query, "path")));
  });

  return router;
}
