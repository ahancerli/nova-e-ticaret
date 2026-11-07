import { Repository } from "@/core";
import type { AiModelRepository } from "../application/ports";
import type { AiModelOption, AiModelStatus, AiProvider } from "../domain/providers";

type Raw = { provider: AiProvider; model_id: string; label: string; note: string | null; status: AiModelStatus; retires_at: string | null };
const COLS = "provider, model_id, label, note, status, retires_at";
const toOption = (r: Raw): AiModelOption => ({ provider: r.provider, id: r.model_id, label: r.label, note: r.note, status: r.status, retiresAt: r.retires_at });

export class D1AiModelRepository extends Repository implements AiModelRepository {
  async listSelectable(): Promise<AiModelOption[]> {
    const rows = await this.db.all<Raw>(`SELECT ${COLS} FROM ai_models WHERE status <> 'retired' ORDER BY provider, status = 'deprecated', sort_order, model_id`);
    return rows.map(toOption);
  }

  async find(provider: AiProvider, modelId: string): Promise<AiModelOption | null> {
    const r = await this.db.first<Raw>(`SELECT ${COLS} FROM ai_models WHERE provider = ? AND model_id = ?`, provider, modelId);
    return r ? toOption(r) : null;
  }
}
