import {
  pgTable,
  pgEnum,
  text,
  integer,
  real,
  boolean,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("users_role", ["admin", "staff"]);
export const userStatusEnum = pgEnum("users_status", ["active", "inactive"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRoleEnum("role").notNull().default("staff"),
  status: userStatusEnum("status").notNull().default("active"),
  apiKey: text("api_key").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  /** UI language preference for emails: "ar" | "en" */
  language: text("language").notNull().default("en"),
});

export const userScopes = pgTable("user_scopes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  grantedBy: text("granted_by"),
  grantedAt: text("granted_at").notNull(),
});

export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  phone2: text("phone2"),
  /** Wilaya FK — authority for wilaya. Kept in sync with `wilaya` text column. */
  wilayaId: integer("wilaya_id").references(() => wilayas.id),
  /** Commune FK — authority for commune. Kept in sync with `commune` text column. */
  communeId: text("commune_id").references(() => communes.id),
  wilaya: text("wilaya").notNull(),
  commune: text("commune"),
  address: text("address"),
  totalOrders: integer("total_orders").notNull().default(0),
  totalSpent: real("total_spent").notNull().default(0),
  createdAt: text("created_at").notNull(),
  lastOrderAt: text("last_order_at"),
});

export const customerGroups = pgTable("customer_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** Hex color for UI display, e.g. "#6366f1" */
  color: text("color").notNull().default("#6366f1"),
  /** Denormalised count — incremented/decremented on member add/remove. */
  memberCount: integer("member_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const customerGroupMembers = pgTable("customer_group_members", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  groupId: text("group_id")
    .notNull()
    .references(() => customerGroups.id, { onDelete: "cascade" }),
  assignedAt: text("assigned_at").notNull(),
}, (t) => ({
  customerGroupUnique: uniqueIndex("customer_group_members_customer_group_unique").on(t.customerId, t.groupId),
}));

export const customerTags = pgTable("customer_tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#64748b"),
  assignmentCount: integer("assignment_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const customerTagAssignments = pgTable("customer_tag_assignments", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  tagId: text("tag_id")
    .notNull()
    .references(() => customerTags.id, { onDelete: "cascade" }),
  assignedAt: text("assigned_at").notNull(),
}, (t) => ({
  customerTagUnique: uniqueIndex("customer_tag_assignments_customer_tag_unique").on(t.customerId, t.tagId),
}));

export const wilayas = pgTable("wilayas", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
});

export const communes = pgTable("communes", {
  id: text("id").primaryKey(),
  wilayaId: integer("wilaya_id")
    .notNull()
    .references(() => wilayas.id),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  postalCode: text("postal_code"),
});

export const carrierWilayas = pgTable("carrier_wilayas", {
  carrierCode: text("carrier_code").notNull(),
  wilayaId: integer("wilaya_id")
    .notNull()
    .references(() => wilayas.id),
  carrierName: text("carrier_name").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.carrierCode, t.wilayaId] }),
}));

export const carrierCommunes = pgTable("carrier_communes", {
  carrierCode: text("carrier_code").notNull(),
  communeId: text("commune_id")
    .notNull()
    .references(() => communes.id),
  carrierName: text("carrier_name").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.carrierCode, t.communeId] }),
}));

export const shippingProfiles = pgTable("shipping_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** When true, rates from this profile are auto-applied on order creation. */
  isDefault: boolean("is_default").notNull().default(false),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const shippingRules = pgTable("shipping_rules", {
  id: text("id").primaryKey(),
  profileId: text("profile_id")
    .notNull()
    .references(() => shippingProfiles.id, { onDelete: "cascade" }),
  wilayaId: integer("wilaya_id")
    .notNull()
    .references(() => wilayas.id),
  homePrice: real("home_price").notNull().default(0),
  stopDeskPrice: real("stop_desk_price").notNull().default(0),
  /** Whether home delivery is offered to this wilaya under this profile. */
  homeEnabled: boolean("home_enabled").notNull().default(true),
  /** Whether stop-desk pickup is offered to this wilaya under this profile. */
  stopDeskEnabled: boolean("stop_desk_enabled").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const shippingRuleCommunes = pgTable("shipping_rule_communes", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id")
    .notNull()
    .references(() => shippingRules.id, { onDelete: "cascade" }),
  communeId: text("commune_id")
    .notNull()
    .references(() => communes.id, { onDelete: "cascade" }),
  /** null = inherit from wilaya rule. */
  homeEnabled: boolean("home_enabled"),
  /** null = inherit from wilaya rule. */
  stopDeskEnabled: boolean("stop_desk_enabled"),
  /** null = inherit price from wilaya rule. */
  homePrice: real("home_price"),
  /** null = inherit price from wilaya rule. */
  stopDeskPrice: real("stop_desk_price"),
}, (t) => ({
  ruleCommuneUnique: uniqueIndex("shipping_rule_communes_unique").on(t.ruleId, t.communeId),
}));

export const driverVehicleEnum = pgEnum("drivers_vehicle_type", ["motorcycle", "car", "van"]);
export const driverStatusEnum = pgEnum("drivers_status", ["available", "busy", "inactive"]);

export const drivers = pgTable("drivers", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  phone2: text("phone2"),
  vehicleType: driverVehicleEnum("vehicle_type"),
  status: driverStatusEnum("status").notNull().default("available"),
  /** Cumulative deliveries completed (incremented on status → delivered). */
  totalDelivered: integer("total_delivered").notNull().default(0),
  /** Cumulative delivery fees earned (incremented on status → delivered). */
  totalEarnings: real("total_earnings").notNull().default(0),
  /** COD cash collected by driver but not yet remitted to the business. */
  pendingCash: real("pending_cash").notNull().default(0),
  /** Total COD cash remitted to the business. */
  totalPaid: real("total_paid").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const driverCompensations = pgTable("driver_compensations", {
  id: text("id").primaryKey(),
  driverId: text("driver_id")
    .notNull()
    .references(() => drivers.id, { onDelete: "cascade" }),
  wilayaId: integer("wilaya_id")
    .notNull()
    .references(() => wilayas.id),
  /** What the store pays this driver per delivery in this wilaya. */
  feePerDelivery: real("fee_per_delivery").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  driverWilayaUnique: uniqueIndex("driver_compensations_driver_wilaya_unique").on(t.driverId, t.wilayaId),
}));

export const driverPaymentTypeEnum = pgEnum("driver_payments_type", ["cod_remittance", "fee_payment", "net_settlement"]);

export const driverPayments = pgTable("driver_payments", {
  id: text("id").primaryKey(),
  driverId: text("driver_id")
    .notNull()
    .references(() => drivers.id, { onDelete: "cascade" }),
  type: driverPaymentTypeEnum("type").notNull(),
  /** Settled amount (COD total, fee total, or net COD−fees depending on type). */
  amount: real("amount").notNull(),
  /** Number of orders included in this payment batch. */
  orderCount: integer("order_count").notNull().default(0),
  notes: text("notes"),
  /** User ID of the team member who recorded this payment. */
  createdBy: text("created_by").notNull(),
  /** Denormalised display name for audit trail. */
  createdByName: text("created_by_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const deliveryCompanies = pgTable("delivery_companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  /** Short unique code used in API calls and display. e.g. "yalidine" */
  code: text("code").notNull().unique(),
  website: text("website"),
  active: boolean("active").notNull().default(true),
  /** Base URL of the company's REST API. */
  apiEndpoint: text("api_endpoint"),
  /** Bearer token or API key for authentication. */
  apiToken: text("api_token"),
  /** NOEST-specific user GUID required for shipment creation. */
  apiUserGuid: text("api_user_guid"),
  supportsHomeDelivery: boolean("supports_home_delivery").notNull().default(true),
  supportsStopDesk: boolean("supports_stop_desk").notNull().default(true),
  supportsTracking: boolean("supports_tracking").notNull().default(false),
  /**
   * ZR Express: "whsec_xxx" Svix secret fetched from ZR webhook endpoint API.
   * Yalidine: secret key from Yalidine Webhooks Dashboard.
   * null = signature verification skipped (warn in logs).
   */
  webhookSecret: text("webhook_secret"),
  /**
   * ZR Express only: registered endpoint UUID returned by ZR webhook registration API.
   * Used for unregister calls. null for Yalidine (manual setup, no endpoint ID).
   */
  webhookEndpointId: text("webhook_endpoint_id"),
  /**
   * ZR Express only: custom state name → our status mapping stored as JSON.
   * Format: { ourStatus: [zrStateName, ...] }
   * null = use code defaults only. null for Yalidine (statuses are hardcoded).
   */
  webhookStatusMapping: text("webhook_status_mapping"),
  /**
   * If true, our dispatcher calls valid/order immediately after create/order (default).
   * If false, the team must manually validate via POST /orders/:id/validate-shipment.
   * Set false for Packers (ecotrack) — team controls when parcel enters courier flow.
   */
  autoValidate: boolean("auto_validate").notNull().default(true),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const orderStatusEnum = pgEnum("orders_status", [
  "new",
  "confirmed",
  "unreachable",
  "no_answer_1",
  "no_answer_2",
  "no_answer_3",
  "preparing",
  "ready",
  "assigned",
  "dispatched",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
]);
export const orderTypeEnum = pgEnum("orders_order_type", ["online", "offline"]);
export const deliveryMethodEnum = pgEnum("orders_delivery_method", ["unassigned", "driver", "company"]);
export const deliveryTypeEnum = pgEnum("orders_delivery_type", ["home", "stop_desk"]);

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  /** Wilaya ID (integer 1-58) — authority for wilaya. Names derived at query/dispatch time. */
  wilayaId: integer("wilaya_id").references(() => wilayas.id),
  /** Commune FK — authority for commune. Names derived at query/dispatch time. */
  communeId: text("commune_id").references(() => communes.id),
  city: text("city"),
  address: text("address"),
  price: real("price").notNull(),
  notes: text("notes"),
  /** Merchant-private note — dashboard only, never sent to delivery companies. */
  internalNote: text("internal_note"),
  status: orderStatusEnum("status").notNull().default("new"),
  orderType: orderTypeEnum("order_type").notNull().default("online"),
  /**
   * "unassigned" at creation — the customer only picks a price tier; the admin
   * later picks how to fulfil (driver vs company). Writes to driver/company
   * assignment endpoints flip this automatically.
   */
  deliveryMethod: deliveryMethodEnum("delivery_method").notNull().default("unassigned"),
  driverId: text("driver_id").references(() => drivers.id),
  companyId: text("company_id").references(() => deliveryCompanies.id),
  assignedAt: text("assigned_at"),
  assignedBy: text("assigned_by"),
  assignmentNotes: text("assignment_notes"),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  externalOrderId: text("external_order_id"),
  deliveryType: deliveryTypeEnum("delivery_type").notNull().default("home"),
  /**
   * Stop-desk / pickup-point station code.
   * Required when deliveryType = "stop_desk".
   * NOEST: alphanumeric station code (e.g. "16A").
   * ZR Express: territory UUID of the pickup-point (detected by UUID format in adapter).
   * Both providers use this single field — adapter auto-detects the format.
   */
  stationCode: text("station_code"),
  /**
   * Delivery fee charged to the customer (from the store's shipping profile).
   * Set at order creation and NEVER changed after that.
   */
  deliveryFee: real("delivery_fee").notNull().default(0),
  /**
   * The driver's cut for this delivery (from the driver's shipping profile for this wilaya).
   * Set when a driver is assigned.
   */
  driverFee: real("driver_fee").notNull().default(0),
  /**
   * Cash-on-delivery amount the driver must collect from the customer.
   * Set to order.price + delivery_fee on creation. Added to driver.pendingCash when delivered.
   */
  codAmount: real("cod_amount").notNull().default(0),
  /** Parcel weight in kg — sent to carrier API when set (optional). */
  weight: real("weight"),
  /** Fragile parcel flag — sent to carrier API when set (optional). */
  isFragile: boolean("is_fragile"),
  pickupTime: text("pickup_time"),
  deliveryTime: text("delivery_time"),
  deliveryAttempts: integer("delivery_attempts").default(0),
  photos: text("photos"),
  /** Set when the COD amount of this order has been remitted to the shop. */
  codPaymentId: text("cod_payment_id"),
  /** Set when the driver's delivery fee for this order has been paid out. */
  feePaymentId: text("fee_payment_id"),
  /** _fbc cookie captured at placement — links the sale back to the ad click. */
  fbc: text("fbc"),
  /** _fbp cookie captured at placement — browser identity for EMQ. */
  fbp: text("fbp"),
  /** CF-Connecting-IP at placement — sent as client_ip_address in CAPI event. */
  ipAddress: text("ip_address"),
  /** User-Agent at placement — sent as client_user_agent in CAPI event. */
  userAgent: text("user_agent"),
  /** Landing page the order was placed from (best-effort attribution — never blocks an order). */
  landingPageId: text("landing_page_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const orderAssigneeTypeEnum = pgEnum("order_assignments_assignee_type", ["driver", "company"]);
export const orderAssignmentStatusEnum = pgEnum("order_assignments_status", ["assigned", "accepted", "picked_up", "delivered", "returned", "cancelled"]);

export const orderAssignments = pgTable("order_assignments", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  assigneeType: orderAssigneeTypeEnum("assignee_type").notNull(),
  assigneeId: text("assignee_id").notNull(),
  assigneeName: text("assignee_name").notNull(),
  assignedBy: text("assigned_by").notNull(),
  assignedAt: text("assigned_at").notNull(),
  unassignedAt: text("unassigned_at"),
  reason: text("reason"),
  acceptedAt: text("accepted_at"),
  pickupAt: text("pickup_at"),
  deliveredAt: text("delivered_at"),
  status: orderAssignmentStatusEnum("status").notNull().default("assigned"),
});

export const orderStatusHistory = pgTable("order_status_history", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  status: orderStatusEnum("status").notNull(),
  timestamp: text("timestamp").notNull(),
  by: text("by"),
});

export const productCategories = pgTable("product_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  parentId: text("parent_id"),
  imageUrl: text("image_url"),
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  metaKeywords: text("meta_keywords"),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const productTypeEnum = pgEnum("products_type", ["PHYSICAL", "DIGITAL"]);
export const productStatusEnum = pgEnum("products_status", ["DRAFT", "ACTIVE", "ARCHIVED"]);

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  handle: text("handle").notNull().unique(),
  currency: text("currency").notNull().default("DZD"),
  price: integer("price").notNull(),
  compareAtPrice: integer("compare_at_price"),
  costPrice: integer("cost_price"),
  type: productTypeEnum("type").notNull().default("PHYSICAL"),
  hasVariants: boolean("has_variants").notNull().default(false),
  variantOptions: text("variant_options"),
  sku: text("sku").unique(),
  inventory: integer("inventory").notNull().default(0),
  /**
   * Master inventory toggle. When false, the product is excluded from stock
   * tracking entirely:
   *   - Simple: products.inventory is ignored; orders never deduct it.
   *   - Variant parent: ALL of its variants are excluded — orders never deduct
   *     from any variant, and stock alerts/overview hide the whole product.
   * Variant rows do not have their own toggle; the parent flag governs them.
   */
  trackInventory: boolean("track_inventory").notNull().default(true),
  /** Alert when inventory drops to or below this number (0 = disabled). */
  lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
  categoryId: text("category_id").references(() => productCategories.id, { onDelete: "set null" }),
  tags: text("tags"),
  visibility: boolean("visibility").notNull().default(true),
  status: productStatusEnum("status").notNull().default("ACTIVE"),
  showInStore: boolean("show_in_store").notNull().default(true),
  storeFeatured: boolean("store_featured").notNull().default(false),
  deletedAt: text("deleted_at"),
  publishedAt: text("published_at"),
  /**
   * Product-level shipping profile override.
   * When set: orders of this product use this profile for deliveryFee resolution.
   * When null: store default profile (isDefault=true) is used.
   */
  shippingProfileId: text("shipping_profile_id")
    .references(() => shippingProfiles.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const productVariants = pgTable("product_variants", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  variations: text("variations").notNull(),
  currency: text("currency").notNull().default("DZD"),
  price: integer("price").notNull(),
  compareAtPrice: integer("compare_at_price"),
  sku: text("sku").notNull().unique(),
  barcode: text("barcode"),
  inventory: integer("inventory").notNull().default(0),
  /** Alert when variant inventory drops to or below this number (0 = disabled). */
  lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
  weightKg: real("weight_kg"),
  imageId: text("image_id"),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const productImages = pgTable("product_images", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  src: text("src").notNull(),
  r2Key: text("r2_key"),
  srcSm: text("src_sm"),
  srcMd: text("src_md"),
  srcLg: text("src_lg"),
  altText: text("alt_text"),
  width: integer("width"),
  height: integer("height"),
  type: integer("type").notNull().default(1),
  position: integer("position").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Status lifecycle value for orders — derived from the column enum. */
export type OrderStatus = (typeof orders.$inferSelect)["status"];

export const orderProductStatusEnum = pgEnum("order_products_status", ["fulfilled", "partially_returned", "returned"]);

export const orderProducts = pgTable("order_products", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  productName: text("product_name").notNull(),
  variantId: text("variant_id").references(() => productVariants.id),
  variantLabel: text("variant_label"),
  sku: text("sku"),
  quantity: integer("quantity").notNull(),
  pricePerUnit: real("price_per_unit").notNull(),
  lineTotal: real("line_total").notNull(),
  /**
   * Per-line fulfilment outcome — supports Algerian box-opening returns.
   *   fulfilled           — customer kept all units (returnedQuantity = 0)
   *   partially_returned  — customer kept some, returned some (0 < returnedQuantity < quantity)
   *   returned            — customer refused the whole line (returnedQuantity = quantity)
   */
  status: orderProductStatusEnum("status").notNull().default("fulfilled"),
  /** Units the customer refused at the door. 0 when status = fulfilled. */
  returnedQuantity: integer("returned_quantity").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const companyStopDesks = pgTable("company_stop_desks", {
  id: text("id").primaryKey(),
  companyId: text("company_id")
    .notNull()
    .references(() => deliveryCompanies.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  commune: text("commune"),
  wilayaId: integer("wilaya_id").references(() => wilayas.id),
  address: text("address"),
  phones: text("phones"),
  /** Admin-controlled: false = hidden from dispatch dialog. Never reset by sync. */
  active: boolean("active").notNull().default(true),
  syncedAt: text("synced_at").notNull(),
}, (t) => ({
  companyCodeUnique: uniqueIndex("company_stop_desks_company_code_unique").on(t.companyId, t.code),
}));

export const companyShipments = pgTable("company_shipments", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  companyId: text("company_id")
    .notNull()
    .references(() => deliveryCompanies.id),
  /** Tracking number returned by the company API (e.g. "ECS12345678"). */
  trackingNumber: text("tracking_number").notNull(),
  /** Whether the shipment has been validated via the company's validate endpoint. */
  validated: boolean("validated").notNull().default(false),
  /** URL to the printable shipping label PDF, if available. */
  labelUrl: text("label_url"),
  /** Raw JSON response from the create-shipment API call. */
  rawResponse: text("raw_response"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const companyApiLogs = pgTable("company_api_logs", {
  id: text("id").primaryKey(),
  companyId: text("company_id")
    .notNull()
    .references(() => deliveryCompanies.id),
  /** The order this call was related to, if any. */
  orderId: text("order_id").references(() => orders.id),
  /** Short action name: "create_shipment", "validate", "track", "delete", "get_fees" */
  action: text("action").notNull(),
  method: text("method").notNull(),
  endpoint: text("endpoint").notNull(),
  /** Serialised request payload (sensitive fields stripped). */
  requestBody: text("request_body"),
  httpStatus: integer("http_status"),
  /** Serialised response body (truncated if large). */
  responseBody: text("response_body"),
  success: boolean("success").notNull().default(false),
  errorMessage: text("error_message"),
  /** Round-trip time in milliseconds. */
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull(),
});

export const storeLangEnum = pgEnum("stores_lang", ["ar", "en"]);
export const storeStatusEnum = pgEnum("stores_status", ["active", "inactive"]);

export const stores = pgTable("stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain"),
  logoUrl: text("logo_url"),
  /** Active theme slug: "theme01", "theme02", etc. */
  themeId: text("theme_id").notNull().default("theme01"),
  /** Primary CTA color (hex, e.g. "#7c3aed") */
  primaryColor: text("primary_color").notNull().default("#7c3aed"),
  /** Accent / highlight color */
  accentColor: text("accent_color").notNull().default("#f59e0b"),
  /** Background color */
  bgColor: text("bg_color").notNull().default("#f8f8f8"),
  /** CSS font-family string */
  fontFamily: text("font_family").notNull().default("Cairo, sans-serif"),
  /** Google Fonts import URL (optional override) */
  fontUrl: text("font_url"),
  /** Store UI language: "ar" | "en" */
  lang: storeLangEnum("lang").notNull().default("ar"),
  currency: text("currency").notNull().default("DZD"),
  currencySymbol: text("currency_symbol").notNull().default("دج"),
  /**
   * JSON blob of every text string shown in the storefront.
   * Schema: StoreFrontContent (see cod-astro/theme01/src/lib/content.ts)
   * Editable from the dashboard Store Settings page.
   */
  contentJson: text("content_json"),
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  ogImage: text("og_image"),
  /** Top announcement bar text (null = hidden) */
  announcementBar: text("announcement_bar"),
  /** When false, reviews are hidden on the storefront and submission is disabled. */
  reviewsEnabled: boolean("reviews_enabled").notNull().default(true),
  status: storeStatusEnum("status").notNull().default("active"),
  /** Plaintext storefront API key — written on every provision so the merchant can view it in settings. */
  storeApiKey: text("store_api_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const storeApiKeys = pgTable("store_api_keys", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  /** SHA-256 hex digest of the raw key */
  keyHash: text("key_hash").notNull().unique(),
  name: text("name").notNull().default("default"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
});

export const reviewStatusEnum = pgEnum("reviews_status", ["pending", "approved", "rejected"]);

export const reviews = pgTable("reviews", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  /** Denormalised order number for display (e.g. "ORD-0042"). */
  orderNumber: text("order_number").notNull(),
  /** Denormalised customer name from the order at submission time. */
  customerName: text("customer_name").notNull(),
  /** Star rating 1–5. Enforced at application layer and DB CHECK. */
  rating: integer("rating").notNull(),
  title: text("title"),
  body: text("body").notNull(),
  status: reviewStatusEnum("status").notNull().default("pending"),
  helpfulCount: integer("helpful_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  orderUnique: uniqueIndex("reviews_order_unique").on(t.orderId),
}));

export const actorRoleEnum = pgEnum("activity_logs_actor_role", ["admin", "staff"]);

export const activityLogs = pgTable("activity_logs", {
  id: text("id").primaryKey(),
  /** ID of the user who performed the action. */
  actorId: text("actor_id").notNull(),
  /** Denormalised name — preserved even if user is later deleted. */
  actorName: text("actor_name").notNull(),
  actorRole: actorRoleEnum("actor_role").notNull(),
  /** Dot-notation action: "order.created", "user.role_changed", etc. */
  action: text("action").notNull(),
  /** Entity category: "order", "customer", "driver", "product", "user". */
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  /** Human-readable label at the time of action (order number, name, etc.). */
  entityLabel: text("entity_label"),
  /** Extra context as JSON (e.g. status transitions, amounts). */
  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
});

export const stockMovementTypeEnum = pgEnum("stock_movements_type", [
  "PURCHASE",
  "ADJUSTMENT_ADD",
  "ADJUSTMENT_REMOVE",
  "ORDER_DEDUCTED",
  "ORDER_CANCELLED",
  "ORDER_RETURNED",
  "OFFLINE_SALE",
]);

export const stockMovements = pgTable("stock_movements", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  /** NULL for simple products (hasVariants = false). */
  variantId: text("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
  type: stockMovementTypeEnum("type").notNull(),
  /** Signed quantity change. Positive = stock in, negative = stock out. Never zero. */
  delta: integer("delta").notNull(),
  /** Inventory level immediately before this movement was applied. */
  qtyBefore: integer("qty_before").notNull(),
  /** Inventory level immediately after this movement was applied. */
  qtyAfter: integer("qty_after").notNull(),
  /** Human note explaining the reason (required for manual adjustments and offline sales). */
  reason: text("reason"),
  /** External reference — orderId for ORDER_* types, null otherwise. */
  reference: text("reference"),
  /** User ID of the team member who triggered this movement. */
  createdBy: text("created_by").notNull(),
  /** Denormalised name — preserved even if the user is later deleted. */
  createdByName: text("created_by_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  /** 'zr_express' | 'yalidine' */
  provider: text("provider").notNull(),
  /** svix-id header (ZR) or event_id field (Yalidine) — idempotency key */
  eventId: text("event_id").notNull(),
  companyId: text("company_id")
    .notNull()
    .references(() => deliveryCompanies.id),
  /** null if order not found by tracking/reference */
  orderId: text("order_id").references(() => orders.id),
  /** raw tracking number from the provider payload */
  tracking: text("tracking"),
  /** 'parcel.state.updated' / 'parcel_status_updated' / etc. */
  eventType: text("event_type").notNull(),
  /** full JSON body for debugging and future reprocessing */
  rawPayload: text("raw_payload").notNull(),
  /** 'ok' | 'ignored' | 'unmapped' | 'error' */
  result: text("result").notNull().default("pending"),
  /** the status we set on the order (when result='ok') */
  newStatus: text("new_status"),
  /** Yalidine reason field / ZR situation name */
  reason: text("reason"),
  errorMsg: text("error_msg"),
  processedAt: text("processed_at"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  providerEventUnique: uniqueIndex("webhook_events_provider_event_unique").on(t.provider, t.eventId),
}));

export const offerDiscountTypeEnum = pgEnum("offers_discount_type", ["free", "free_shipping"]);
export const offerStatusEnum = pgEnum("offers_status", ["active", "inactive"]);

export const offers = pgTable("offers", {
  id: text("id").primaryKey(),
  /** Human-readable name shown in dashboard, e.g. "اشترِ 2 واحصل على 1 مجاناً" */
  name: text("name").notNull(),
  /** Product the customer must buy to trigger this offer. */
  triggerProductId: text("trigger_product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  /**
   * Optional: restrict trigger to a specific variant.
   * null = any variant (or simple product) of triggerProduct triggers the offer.
   */
  triggerVariantId: text("trigger_variant_id")
    .references(() => productVariants.id, { onDelete: "set null" }),
  /** Minimum quantity the customer must order to trigger the offer. */
  triggerQuantity: integer("trigger_quantity").notNull().default(2),
  /**
   * Product given as reward.
   * NULL when discountType = 'free_shipping' (no product reward — shipping is free instead).
   */
  rewardProductId: text("reward_product_id")
    .references(() => products.id, { onDelete: "cascade" }),
  /**
   * Optional: specific variant to give as reward.
   * null + rewardProductId === triggerProductId → same variantId the customer ordered.
   * null + rewardProductId !== triggerProductId → default/first active variant.
   * Set explicitly when rewardProduct has variants and differs from triggerProduct.
   */
  rewardVariantId: text("reward_variant_id")
    .references(() => productVariants.id, { onDelete: "set null" }),
  /** Quantity of reward items to add for free. 0 when discountType = 'free_shipping'. */
  rewardQuantity: integer("reward_quantity").notNull().default(1),
  /**
   * "free"          = reward items at pricePerUnit = 0 (Buy X Get Y free product).
   * "free_shipping" = delivery fee overridden to 0 (no reward product inserted).
   */
  discountType: offerDiscountTypeEnum("discount_type").notNull().default("free"),
  /** ISO 8601 datetime. null = active immediately. */
  startsAt: text("starts_at"),
  /** ISO 8601 datetime. null = never expires. */
  endsAt: text("ends_at"),
  status: offerStatusEnum("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const landingPageStatusEnum = pgEnum("landing_pages_status", ["draft", "published", "archived"]);

export const landingPages = pgTable("landing_pages", {
  id: text("id").primaryKey(),
  /** Public URL identifier: [a-z0-9-]{3,60}. Auto-generated `lp-<8char>` default. */
  slug: text("slug").notNull().unique(),
  /** Internal label, e.g. "Zinc v3 — carousel ad". Never rendered publicly. */
  name: text("name").notNull(),
  /** The single product this page sells. */
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  status: landingPageStatusEnum("status").notNull().default("draft"),
  /** Pixels between stacked images. 0 = flush stack. */
  imageGap: integer("image_gap").notNull().default(0),
  /** Pixels of page side padding. 0 = full-bleed. */
  sidePadding: integer("side_padding").notNull().default(0),
  /** Max content width in pixels. 0 = full width (mobile-first default). */
  contentMaxWidth: integer("content_max_width").notNull().default(0),
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  /** Render count of the published page (non-unique in v1). */
  views: integer("views").notNull().default(0),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const landingPageImageSourceEnum = pgEnum("landing_page_images_source", ["upload", "ai"]);

export const landingPageImages = pgTable("landing_page_images", {
  id: text("id").primaryKey(),
  landingPageId: text("landing_page_id")
    .notNull()
    .references(() => landingPages.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  src: text("src").notNull(),
  altText: text("alt_text"),
  source: landingPageImageSourceEnum("source").notNull().default("upload"),
  position: integer("position").notNull().default(1),
  width: integer("width"),
  height: integer("height"),
  createdAt: text("created_at").notNull(),
});

export const dashboardBrand = pgTable("dashboard_brand", {
  id: text("id").primaryKey().default("default"),
  brandName: text("brand_name").notNull().default("Dashboard"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").notNull().default("#7c3aed"),
  metaTitle: text("meta_title"),
  faviconUrl: text("favicon_url"),
  updatedAt: text("updated_at").notNull(),
});

export const conversionEventEnum = pgEnum("conversion_event", ["Lead", "Purchase", "Purchase_Confirmed", "Purchase_Delivered"]);

export const storePixelConfig = pgTable("store_pixel_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  pixelId: text("pixel_id").notNull(),
  /** Merchant's label for the Meta ad account this pixel belongs to — reference only, never sent to Meta. */
  adAccountName: text("ad_account_name"),
  accessToken: text("access_token").notNull(),
  /** Meta test event code — used during integration testing only. Set to null in production. */
  testEventCode: text("test_event_code"),
  /** Which CAPI event the merchant optimizes for — chosen explicitly in the dashboard, never defaulted by the UI. */
  conversionEvent: conversionEventEnum("conversion_event").notNull().default("Purchase"),
  /** When true, CAPI events carry test_event_code to Meta's test stream instead of production measurement. */
  testMode: boolean("test_mode").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const storeFormConfig = pgTable("store_form_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  /** Active order form variant: "default" (untouched OrderForm) or a theme variation key like "form_a". */
  variant: text("variant").notNull().default("default"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const storeTiktokConfig = pgTable("store_tiktok_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  pixelId: text("pixel_id").notNull(),
  /** Merchant's label for the TikTok ad account this pixel belongs to — reference only, never sent to TikTok. */
  adAccountName: text("ad_account_name"),
  accessToken: text("access_token").notNull(),
  /** TikTok test event code — used during integration testing only. Set to null in production. */
  testEventCode: text("test_event_code"),
  /** Which Events API event the merchant optimizes for — chosen explicitly in the dashboard, never defaulted by the UI. */
  conversionEvent: conversionEventEnum("conversion_event").notNull().default("Purchase"),
  /** When true, Events API calls carry test_event_code to TikTok's test stream instead of production measurement. */
  testMode: boolean("test_mode").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tiktokEventLog = pgTable("tiktok_event_log", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  eventName: text("event_name").notNull(),
  stage: text("stage").notNull().default("delivered"),
  status: text("status").notNull(),
  tiktokEventId: text("tiktok_event_id"),
  error: text("error"),
  sentAt: text("sent_at").notNull(),
}, (t) => ({
  orderIdx: index("idx_tiktok_event_log_order").on(t.orderId),
  claimIdx: uniqueIndex("idx_tiktok_event_log_claim").on(t.orderId, t.stage, t.eventName),
}));

export const otpLanguageEnum = pgEnum("store_otp_config_language", ["en", "fr", "ar"]);

export const storeOtpConfig = pgTable("store_otp_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  apiKey: text("api_key").notNull(),
  /** WhatsApp message language for OTP sends: en | fr | ar. */
  language: otpLanguageEnum("language").notNull().default("ar"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const storeEmailConfig = pgTable("store_email_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  apiKey: text("api_key").notNull(),
  /** Verified sender address — its domain must be verified in the Sendili workspace. */
  fromEmail: text("from_email").notNull(),
  /** Optional sender display name (e.g. the store name). */
  fromName: text("from_name"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const storeTurnstileConfig = pgTable("store_turnstile_config", {
  id: text("id").primaryKey(),
  storeId: text("store_id")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  /** Public widget site key — safe to expose to the storefront. */
  siteKey: text("site_key").notNull(),
  /** Server-side siteverify secret — never returned to any client. */
  secretKey: text("secret_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const capiEventLog = pgTable(
  "capi_event_log",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    eventName: text("event_name").notNull(),
    stage: text("stage").notNull().default("delivered"),
    status: text("status").notNull(),
    metaEventId: text("meta_event_id"),
    error: text("error"),
    sentAt: text("sent_at").notNull(),
  },
  (t) => ({
    orderIdx: index("idx_capi_event_log_order").on(t.orderId),
    claimUnique: uniqueIndex("idx_capi_event_log_claim").on(t.orderId, t.stage, t.eventName),
  })
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("sessions_user_id_idx").on(t.userId),
}));

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  issuer: text("issuer"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("accounts_user_id_idx").on(t.userId),
}));

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  identifierIdx: index("verifications_identifier_idx").on(t.identifier),
}));

export const jwkss = pgTable("jwkss", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
});

export const oauthClients = pgTable("oauthClients", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  disabled: boolean("disabled").default(false),
  skipConsent: boolean("skip_consent"),
  enableEndSession: boolean("enable_end_session"),
  subjectType: text("subject_type"),
  scopes: text("scopes"),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts"),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: text("redirect_uris").notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris"),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  grantTypes: text("grant_types"),
  responseTypes: text("response_types"),
  type: text("type"),
  public: boolean("public"),
  clientIdIssuedAt: timestamp("client_id_issued_at"),
  clientSecretExpiresAt: timestamp("client_secret_expires_at"),
  requirePkce: boolean("require_pkce"),
  referenceId: text("reference_id"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("oauthClients_user_id_idx").on(t.userId),
}));

export const oauthRefreshTokens = pgTable("oauthRefreshTokens", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revoked: timestamp("revoked"),
  authTime: timestamp("auth_time"),
  scopes: text("scopes").notNull(),
}, (t) => ({
  tokenIdx: index("oauthRefreshTokens_token_idx").on(t.token),
  userIdIdx: index("oauthRefreshTokens_user_id_idx").on(t.userId),
  clientIdIdx: index("oauthRefreshTokens_client_id_idx").on(t.clientId),
}));

export const oauthAccessTokens = pgTable("oauthAccessTokens", {
  id: text("id").primaryKey(),
  token: text("token").unique(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  scopes: text("scopes").notNull(),
}, (t) => ({
  userIdIdx: index("oauthAccessTokens_user_id_idx").on(t.userId),
  clientIdIdx: index("oauthAccessTokens_client_id_idx").on(t.clientId),
}));

export const oauthConsents = pgTable("oauthConsents", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClients.clientId),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  scopes: text("scopes").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userClientIdx: index("oauthConsents_user_client_idx").on(t.userId, t.clientId),
}));

export const abandonedDeliveryTypeEnum = pgEnum("abandoned_orders_delivery_type", ["home", "stop_desk"]);
export const abandonedStatusEnum = pgEnum("abandoned_orders_status", ["pending", "abandoned", "contacted", "no_answer", "converted"]);

export const abandonedOrders = pgTable("abandoned_orders", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  wilayaId: integer("wilaya_id").references(() => wilayas.id),
  communeId: text("commune_id").references(() => communes.id),
  wilayaName: text("wilaya_name"),
  communeName: text("commune_name"),
  productId: text("product_id"),
  productName: text("product_name"),
  variantId: text("variant_id"),
  variantLabel: text("variant_label"),
  price: real("price"),
  deliveryType: abandonedDeliveryTypeEnum("delivery_type"),
  fbc: text("fbc"),
  fbp: text("fbp"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  status: abandonedStatusEnum("status").notNull().default("pending"),
  convertedOrderId: text("converted_order_id"),
  convertedOrderNumber: text("converted_order_number"),
  recoveryAttempts: integer("recovery_attempts").notNull().default(0),
  lastRecoveryAt: text("last_recovery_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => ({
  statusIdx: index("abandoned_orders_status_idx").on(t.status),
  phoneIdx: index("abandoned_orders_phone_idx").on(t.phone),
  createdAtIdx: index("abandoned_orders_created_at_idx").on(t.createdAt),
}));
