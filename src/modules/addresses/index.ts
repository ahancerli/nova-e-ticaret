/** Public surface of the customer address book (Hesabım › Adreslerim, checkout address picker). */
export { MAX_ADDRESSES, type AddressView } from "./domain/address";
export { addressInputSchema, type AddressInput } from "./http/schemas";
export { CreateAddressToken, DeleteAddressToken, ListAddressesToken, UpdateAddressToken, registerAddresses } from "./module";
