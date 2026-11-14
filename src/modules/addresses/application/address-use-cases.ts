import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { GeoDirectory } from "@/modules/geo";
import type { Actor } from "@/modules/shared/actor";
import type { AddressView } from "../domain/address";
import { AddressErrors } from "../domain/errors";
import type { AddressInput } from "../http/schemas";
import type { AddressRepository } from "./ports";

export interface AddressDeps { db: Database; repo: AddressRepository; geo: GeoDirectory; clock: Clock; ids: IdGenerator }

/** Country rules: phone → E.164, Turkish province / district → canonical names from the lists. */
async function checked(geo: GeoDirectory, input: AddressInput): Promise<AddressInput> {
  const region = await geo.region("", input);
  return { ...input, ...region, phone: await geo.phone("phone", input.phone, input.phoneCountry ?? region.countryCode) };
}

/** Query: the signed-in customer's addresses, defaults first. */
export class ListAddresses {
  constructor(private readonly repo: AddressRepository) {}
  execute(userId: string): Promise<AddressView[]> { return this.repo.list(userId); }
}

export class CreateAddress {
  constructor(private readonly d: AddressDeps) {}
  async execute(raw: AddressInput, actor: Actor): Promise<AddressView> {
    const input = await checked(this.d.geo, raw);
    const id = this.d.ids.newId();
    const now = this.d.clock.nowIso();
    await new UnitOfWork(this.d.db)
      .add(this.d.repo.clearDefaultsStatement(actor.userId, id, input.isDefaultShipping, input.isDefaultBilling))
      .add(this.d.repo.insertStatement(actor.userId, id, input, now))
      .expectChanges(1, AddressErrors.limit)
      .add(...this.d.repo.ensureDefaultsStatement(actor.userId, now))
      .commit();
    return (await this.d.repo.find(actor.userId, id))!;
  }
}

export class UpdateAddress {
  constructor(private readonly d: AddressDeps) {}
  async execute(id: string, raw: AddressInput, actor: Actor): Promise<AddressView> {
    const input = await checked(this.d.geo, raw);
    const current = await this.d.repo.find(actor.userId, id);
    if (!current) throw AddressErrors.notFound();
    const now = this.d.clock.nowIso();
    // A default is moved, never just switched off: unticking keeps the flag until another address takes it.
    const next = { ...input, isDefaultShipping: input.isDefaultShipping || current.isDefaultShipping, isDefaultBilling: input.isDefaultBilling || current.isDefaultBilling };
    await new UnitOfWork(this.d.db)
      .add(this.d.repo.clearDefaultsStatement(actor.userId, id, next.isDefaultShipping, next.isDefaultBilling))
      .add(this.d.repo.updateStatement(actor.userId, id, next, now))
      .expectChanges(1, AddressErrors.notFound)
      .commit();
    return (await this.d.repo.find(actor.userId, id))!;
  }
}

export class DeleteAddress {
  constructor(private readonly d: AddressDeps) {}
  async execute(id: string, actor: Actor): Promise<void> {
    await new UnitOfWork(this.d.db)
      .add(this.d.repo.deleteStatement(actor.userId, id))
      .expectChanges(1, AddressErrors.notFound)
      .add(...this.d.repo.ensureDefaultsStatement(actor.userId, this.d.clock.nowIso()))
      .commit();
  }
}
