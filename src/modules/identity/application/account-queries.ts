import { Repository } from "@/core";

/** Read side for account / staff screens (profile card, role badges). */
export class D1AccountReadModel extends Repository {
  staffRoleNames(userId: string): Promise<{ name: string }[]> {
    return this.db.all<{ name: string }>(
      "SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.is_system DESC, r.name", userId,
    );
  }

  async customerProfile(userId: string): Promise<{ firstName: string; lastName: string; locale: string } | null> {
    const r = await this.db.first<{ first_name: string; last_name: string; locale: string }>("SELECT first_name, last_name, locale FROM customer_profiles WHERE user_id = ?", userId);
    return r ? { firstName: r.first_name, lastName: r.last_name, locale: r.locale } : null;
  }
}

/** Query: role names of a staff member (admin shell user menu). */
export class GetStaffRoles {
  constructor(private readonly read: D1AccountReadModel) {}

  async execute(userId: string): Promise<string[]> {
    return (await this.read.staffRoleNames(userId)).map((r) => r.name);
  }
}

/** Query: storefront "Hesabım" profile card. */
export class GetCustomerProfile {
  constructor(private readonly read: D1AccountReadModel) {}

  execute(userId: string) {
    return this.read.customerProfile(userId);
  }
}
