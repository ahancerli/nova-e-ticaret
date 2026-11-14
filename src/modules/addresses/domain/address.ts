/**
 * Customer address book (Hesabım › Adreslerim). Checkout copies the chosen address into the order
 * (order_addresses), so editing or deleting here never changes a placed order. One default shipping and one
 * default billing address per customer (partial unique indexes); the first address becomes both defaults.
 */
export interface AddressView {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  countryCode: string;
  province: string;
  district: string;
  line1: string;
  line2: string | null;
  postalCode: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  updatedAt: string;
}

export const MAX_ADDRESSES = 20;
