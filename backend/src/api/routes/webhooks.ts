import { Router } from "express";
import { z } from "zod";
import { type WebhookService, webhookEvents } from "../../services/webhookService";
import { parseWebhookUrl } from "../../services/webhookTransport";

const registration = z.object({
  url: z.string().max(2048).refine(value => {
    try {
      parseWebhookUrl(value);
      return true;
    } catch {
      return false;
    }
  }, "A public HTTPS webhook URL is required"),
  events: z.array(z.enum(webhookEvents)).min(1).max(webhookEvents.length)
    .transform(items => [...new Set(items)]),
  secret: z.string().min(1).max(512),
});

const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(Number.MAX_SAFE_INTEGER),
});

export function createWebhooksRouter(service: WebhookService): Router {
  const router = Router();

  router.use((req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "Wallet session required" });
      return;
    }
    next();
  });

  router.post("/", (req, res) => {
    const parsed = registration.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid webhook registration" });
      return;
    }
    res.status(201).json(service.register(req.user!.sub, parsed.data));
  });

  router.get("/", (req, res) => {
    res.json(service.list(req.user!.sub));
  });

  router.delete("/:id", (req, res) => {
    if (!service.remove(req.user!.sub, req.params.id)) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }
    res.sendStatus(204);
  });

  router.get("/:id/deliveries", (req, res) => {
    const parsed = pagination.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid pagination parameters" });
      return;
    }
    const history = service.history(req.user!.sub, req.params.id, parsed.data.limit, parsed.data.cursor);
    if (!history) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }
    res.json(history);
  });

  router.post("/:id/test", (req, res, next) => {
    void service.test(req.user!.sub, req.params.id).then(result => {
      if (!result) {
        res.status(404).json({ error: "Webhook not found" });
        return;
      }
      res.json(result);
    }).catch(next);
  });

  return router;
}
