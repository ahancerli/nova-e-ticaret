import { UnitOfWork, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import {
  ATTRIBUTE_TEMPLATES, attributeCode, attributeProblems, ean13, optionProblems, optionValue,
  type AttributeInput, type AttributeRow, type AttributeTemplateKey, type OptionInput,
} from "../../domain/attribute";
import { AttributeErrors } from "../../domain/errors";
import type { AttributeRepository } from "../ports";

export interface AttributeDeps {
  db: Database;
  attributes: AttributeRepository;
  audit: AuditLog;
  ids: IdGenerator;
}

/** Query: every attribute with options (usage counts) and category assignments. */
export class ListAttributes {
  constructor(private readonly attributes: AttributeRepository) {}
  execute(): Promise<AttributeRow[]> {
    return this.attributes.list();
  }
}

abstract class AttributeCommand {
  constructor(protected readonly deps: AttributeDeps) {}

  protected async load(id: string): Promise<AttributeRow> {
    const a = await this.deps.attributes.find(id);
    if (!a) throw AttributeErrors.notFound();
    return a;
  }

  protected check(a: AttributeInput) {
    const p = attributeProblems(a);
    if (Object.keys(p).length) throw AttributeErrors.invalid(p);
  }

  /** Statements adding options (codes made unique within the attribute). */
  protected optionStatements(attributeId: string, options: OptionInput[], taken: Set<string>, startOrder: number) {
    return options.map((o, i) => {
      const p = optionProblems(o);
      if (Object.keys(p).length) throw AttributeErrors.invalid(p);
      const value = o.value?.trim() ? optionValue(o.value) : optionValue(o.label);
      if (taken.has(value)) throw AttributeErrors.valueTaken(o.label);
      taken.add(value);
      return this.deps.attributes.insertOptionStatement(this.deps.ids.newId(), attributeId, value, o, startOrder + (i + 1) * 10);
    });
  }
}

/** Command: new attribute (optionally with its first values). */
export class CreateAttribute extends AttributeCommand {
  async execute(input: AttributeInput & { options?: OptionInput[] }, actor: Actor): Promise<{ id: string }> {
    this.check(input);
    const code = input.code?.trim() || attributeCode(input.label);
    if (await this.deps.attributes.codeTaken(code, null)) throw AttributeErrors.codeTaken(code);
    const id = this.deps.ids.newId();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.attributes.insertStatement(id, code, input))
      .add(...this.optionStatements(id, input.options ?? [], new Set(), 0))
      .add(this.deps.audit.recordStatement({ actor, action: "attribute.create", entityType: "attribute", entityId: id, diff: { label: input.label, code, type: input.dataType, axis: input.isVariantAxis } }))
      .commit();
    return { id };
  }
}

/** Command: ready-made attribute (Renk, Numara, Halı ölçüsü …) with its usual values. */
export class ApplyAttributeTemplate extends AttributeCommand {
  async execute(key: AttributeTemplateKey, actor: Actor): Promise<{ id: string }> {
    const t = ATTRIBUTE_TEMPLATES[key];
    let code = t.attribute.code;
    for (let i = 2; await this.deps.attributes.codeTaken(code, null); i++) code = `${t.attribute.code}_${i}`;
    return new CreateAttribute(this.deps).execute({ ...t.attribute, code, options: t.options }, actor);
  }
}

/** Command: rename / restyle an attribute. Type and axis role are frozen once products use it. */
export class UpdateAttribute extends AttributeCommand {
  async execute(id: string, input: AttributeInput, actor: Actor): Promise<void> {
    const current = await this.load(id);
    this.check(input);
    if (current.productCount > 0 && (current.dataType !== input.dataType || current.isVariantAxis !== input.isVariantAxis)) throw AttributeErrors.typeLocked();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.attributes.updateStatement(id, input))
      .add(this.deps.audit.recordStatement({ actor, action: "attribute.update", entityType: "attribute", entityId: id, diff: { label: input.label, style: input.displayStyle } }))
      .commit();
  }
}

export class DeleteAttribute extends AttributeCommand {
  async execute(id: string, actor: Actor): Promise<void> {
    const current = await this.load(id);
    if (current.productCount > 0) throw AttributeErrors.inUse(current.productCount);
    await new UnitOfWork(this.deps.db)
      .add(this.deps.attributes.deleteStatement(id)).expectChanges(1, () => AttributeErrors.inUse(1))
      .add(this.deps.audit.recordStatement({ actor, action: "attribute.delete", entityType: "attribute", entityId: id, diff: { label: current.label } }))
      .commit();
  }
}

/** Command: add values (one or many, e.g. pasted "36, 37, 38"). */
export class AddAttributeOptions extends AttributeCommand {
  async execute(id: string, options: OptionInput[], actor: Actor): Promise<{ ids: string[] }> {
    const current = await this.load(id);
    if (current.dataType !== "select" && current.dataType !== "multiselect") throw AttributeErrors.invalid({ options: "Yalnız seçenekli özelliklere değer eklenir." });
    const before = new Set(current.options.map((o) => o.id));
    await new UnitOfWork(this.deps.db)
      .add(...this.optionStatements(id, options, new Set(current.options.map((o) => o.value)), await this.deps.attributes.maxOptionOrder(id)))
      .add(this.deps.audit.recordStatement({ actor, action: "attribute.option_add", entityType: "attribute", entityId: id, diff: { values: options.map((o) => o.label) } }))
      .commit();
    return { ids: (await this.load(id)).options.filter((o) => !before.has(o.id)).map((o) => o.id) };
  }
}

export class UpdateAttributeOption extends AttributeCommand {
  async execute(id: string, optionId: string, input: OptionInput, actor: Actor): Promise<void> {
    const current = await this.load(id);
    if (!current.options.some((o) => o.id === optionId)) throw AttributeErrors.optionNotFound();
    const p = optionProblems(input);
    if (Object.keys(p).length) throw AttributeErrors.invalid(p);
    await new UnitOfWork(this.deps.db)
      .add(this.deps.attributes.updateOptionStatement(optionId, id, input)).expectChanges(1, AttributeErrors.optionNotFound)
      .add(this.deps.audit.recordStatement({ actor, action: "attribute.option_update", entityType: "attribute", entityId: id, diff: { option: input.label, active: input.isActive !== false } }))
      .commit();
  }
}

export class DeleteAttributeOption extends AttributeCommand {
  async execute(id: string, optionId: string, actor: Actor): Promise<void> {
    const current = await this.load(id);
    const opt = current.options.find((o) => o.id === optionId);
    if (!opt) throw AttributeErrors.optionNotFound();
    if (opt.usage > 0) throw AttributeErrors.optionInUse();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.attributes.deleteOptionStatement(optionId, id)).expectChanges(1, AttributeErrors.optionInUse)
      .add(this.deps.audit.recordStatement({ actor, action: "attribute.option_delete", entityType: "attribute", entityId: id, diff: { option: opt.label } }))
      .commit();
  }
}

export class ReorderAttributeOptions extends AttributeCommand {
  async execute(id: string, optionIds: string[], actor: Actor): Promise<void> {
    const current = await this.load(id);
    const mine = new Set(current.options.map((o) => o.id));
    if (optionIds.length !== mine.size || optionIds.some((o) => !mine.has(o))) throw AttributeErrors.invalid({ options: "Sıralama tüm değerleri içermeli." });
    await new UnitOfWork(this.deps.db)
      .add(...this.deps.attributes.reorderOptionStatements(id, optionIds))
      .add(this.deps.audit.recordStatement({ actor, action: "attribute.option_reorder", entityType: "attribute", entityId: id, diff: { count: optionIds.length } }))
      .commit();
  }
}

/** Command: which categories use the attribute and where it is required (also drives the product editor's checks). */
export class SetAttributeCategories extends AttributeCommand {
  async execute(id: string, categories: { categoryId: string; isRequired: boolean }[], actor: Actor): Promise<void> {
    await this.load(id);
    const unique = [...new Map(categories.map((c) => [c.categoryId, c])).values()];
    if ((await this.deps.attributes.existingCategories(unique.map((c) => c.categoryId))) !== unique.length) throw AttributeErrors.unknownCategory();
    await new UnitOfWork(this.deps.db)
      .add(...this.deps.attributes.replaceCategoriesStatements(id, unique))
      .add(this.deps.audit.recordStatement({ actor, action: "attribute.categories", entityType: "attribute", entityId: id, diff: { categories: unique.length, required: unique.filter((c) => c.isRequired).length } }))
      .commit();
  }
}

/** Query + commands: shop barcodes (EAN-13 from the shop's prefix; the GS1 restricted range 2… by default). */
export class GetBarcodeSettings {
  constructor(private readonly attributes: AttributeRepository) {}
  execute() {
    return this.attributes.barcodeSettings();
  }
}

export class SetBarcodePrefix extends AttributeCommand {
  async execute(prefix: string, actor: Actor): Promise<void> {
    if (!/^\d{3,10}$/.test(prefix)) throw AttributeErrors.barcodePrefix();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.attributes.setPrefixStatement(prefix))
      .add(this.deps.audit.recordStatement({ actor, action: "barcode.prefix", entityType: "attribute", entityId: "barcode", diff: { prefix } }))
      .commit();
  }
}

/** Command: `count` new EAN-13 barcodes no variant uses yet (numbers are reserved atomically, so two editors never get the same). */
export class GenerateBarcodes {
  constructor(private readonly attributes: AttributeRepository) {}

  async execute(count: number): Promise<string[]> {
    const out: string[] = [];
    for (let round = 0; out.length < count && round < 5; round++) {
      const need = count - out.length;
      const { prefix, first } = await this.attributes.reserveNumbers(need);
      const codes = Array.from({ length: need }, (_, i) => ean13(prefix, first + i));
      const taken = await this.attributes.takenBarcodes(codes);
      out.push(...codes.filter((c) => !taken.has(c)));
    }
    return out;
  }
}
