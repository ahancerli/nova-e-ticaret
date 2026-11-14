import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { GeoDirectoryToken } from "@/modules/geo";
import { CreateAddress, DeleteAddress, ListAddresses, UpdateAddress, type AddressDeps } from "./application/address-use-cases";
import type { AddressRepository } from "./application/ports";
import { D1AddressRepository } from "./infrastructure/d1-address.repository";

export const AddressRepositoryToken = token<AddressRepository>("AddressRepository");
export const ListAddressesToken = token<ListAddresses>("ListAddresses");
export const CreateAddressToken = token<CreateAddress>("CreateAddress");
export const UpdateAddressToken = token<UpdateAddress>("UpdateAddress");
export const DeleteAddressToken = token<DeleteAddress>("DeleteAddress");

export function registerAddresses(c: Container): void {
  const deps = (r: Resolver): AddressDeps => ({ db: r.resolve(DatabaseToken), repo: r.resolve(AddressRepositoryToken), geo: r.resolve(GeoDirectoryToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken) });
  c.scoped(AddressRepositoryToken, (r) => new D1AddressRepository(r.resolve(DatabaseToken)));
  c.scoped(ListAddressesToken, (r) => new ListAddresses(r.resolve(AddressRepositoryToken)));
  c.scoped(CreateAddressToken, (r) => new CreateAddress(deps(r)));
  c.scoped(UpdateAddressToken, (r) => new UpdateAddress(deps(r)));
  c.scoped(DeleteAddressToken, (r) => new DeleteAddress(deps(r)));
}
