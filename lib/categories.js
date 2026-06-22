// Canonical category key → EXACT sheet label (col G) + section.
// The label must match the sheet text after normalization (trim + collapse spaces + lowercase).
export const CATEGORIES = {
  // HOME
  mortgage_rent: { label: "Mortgage / Rent", section: "HOME" },
  gas: { label: "Gas", section: "HOME" },
  electricity: { label: "Electricity", section: "HOME" },
  water: { label: "Water", section: "HOME" },
  zakah: { label: "Zakkah", section: "HOME" },
  phone: { label: "Phone", section: "HOME" },
  home_internet: { label: "Home Internet", section: "HOME" },
  furnishing: { label: "Furnishing / Appliances / Amazon", section: "HOME" },
  omar_pocket_money: { label: "Omar's Pocket Money", section: "HOME" },
  mariam_pocket_money: { label: "Mariam's Pocket Money", section: "HOME" },
  home_repairs: { label: "Repairs", section: "HOME" },

  // TRANSPORTATION
  fuel: { label: "Fuel", section: "TRANSPORTATION" },
  uber_parking: { label: "Public Transporation / Uber / Parking", section: "TRANSPORTATION" },
  transport_repairs: { label: "Repairs / Maintenance", section: "TRANSPORTATION" },
  registration_license: { label: "Registration / License", section: "TRANSPORTATION" },

  // DAILY LIVING
  groceries: { label: "Groceries", section: "DAILY LIVING" },
  coffee: { label: "Coffee", section: "DAILY LIVING" },
  ordering_in: { label: "Ordering In", section: "DAILY LIVING" },
  dining_out: { label: "Dining Out/Going Out", section: "DAILY LIVING" },
  clothing: { label: "Clothing", section: "DAILY LIVING" },
  cleaning: { label: "Cleaning", section: "DAILY LIVING" },
  salon_barber: { label: "Salon / Barber", section: "DAILY LIVING" },
  tips: { label: "Tips", section: "DAILY LIVING" },
  pet_supplies: { label: "Pet Supplies", section: "DAILY LIVING" },
  health_medicine: { label: "Health and Medicine", section: "DAILY LIVING" }, // sheet may store trailing space
  gym: { label: "Gym", section: "DAILY LIVING" }, // may not exist every month

  // ENTERTAINMENT
  subscriptions: { label: "Subscriptions", section: "ENTERTAINMENT" },
  concerts_movies: { label: "Concerts / Movies", section: "ENTERTAINMENT" },
  pokemon_tcg: { label: "Pokemon TCG", section: "ENTERTAINMENT" },
  entertainment_misc: { label: "Misc.", section: "ENTERTAINMENT" },
};

// Freeform sections (no fixed key): section = "One time payments" | "VACATION"; label from parser.

// Exact section-header strings as they appear in col G.
export const SECTION_HEADERS = [
  "HOME",
  "TRANSPORTATION",
  "DAILY LIVING",
  "ENTERTAINMENT",
  "One time payments",
  "VACATION",
];

/** Normalize a label for tolerant comparison (handles trailing space, double spaces, case). */
export function normalizeLabel(s) {
  return String(s == null ? "" : s)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
