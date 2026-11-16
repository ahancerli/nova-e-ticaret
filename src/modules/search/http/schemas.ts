import { z } from "zod";
import "@/modules/shared/schemas"; // Turkish Zod messages
import { MAX_SYNONYM_WORDS, SYNONYM_KINDS } from "../domain/search";

const word = z.string().trim().min(2, "Kelimeler en az 2 karakter olmalı.").max(40, "Bir kelime en fazla 40 karakter olabilir.");

export const synonymSchema = z.object({
  kind: z.enum(SYNONYM_KINDS),
  term: word.nullable().optional(),
  words: z.array(word).min(1, "En az bir kelime girin.").max(MAX_SYNONYM_WORDS, `Bir kayıtta en fazla ${MAX_SYNONYM_WORDS} kelime olabilir.`),
}).strict();

export const synonymParams = z.object({ id: z.string().min(1).max(64) });

export const searchTermActionSchema = z.object({
  term: z.string().trim().min(2).max(60),
  action: z.enum(["hide", "show", "delete"]),
}).strict();
