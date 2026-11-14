import { ConflictError, NotFoundError } from "@/core";
import { MAX_ADDRESSES } from "./address";

export const AddressErrors = {
  notFound: () => new NotFoundError("address_not_found", "Adres bulunamadı."),
  limit: () => new ConflictError("address_limit", `En fazla ${MAX_ADDRESSES} adres kaydedebilirsiniz. Kullanmadığınız bir adresi silin.`),
};
