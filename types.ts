export type ActivityType = 'flight' | 'attraction' | 'food' | 'transport' | 'accommodation' | 'other';

export type ExpenseCategory = 'flight' | 'accommodation' | 'internet' | 'transport' | 'ticket' | 'food' | 'souvenir' | 'other';
export type PaymentMethod = 'cash' | 'cube_card' | 'credit_card';
export type SplitType = 'me' | 'parents' | 'shared';

export interface Budget {
  id: string;
  category: ExpenseCategory;
  amount: number; // TWD
}

export interface Expense {
  id: string;
  itemId?: string; // Link to itinerary item
  item: string;
  foreignAmount: number;
  twdAmount: number; // Calculated or manually set
  exchangeRate: number;
  currency: string;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  photo?: string; // Base64
  split: SplitType;
  date: string; // ISO Date
}

export interface BookingDetails {
  // Flight
  airline?: string;
  flightNumber?: string;
  terminal?: string;
  gate?: string;
  seat?: string;
  class?: string;
  // Accommodation
  checkInTime?: string;
  checkOutTime?: string;
  guests?: number;
  roomType?: string;
}

export interface ItineraryItem {
  id: string;
  time: string; // Start Time
  endTime?: string; // (10) Duration calculation
  activity: string;
  location: string;
  type: ActivityType;
  note?: string;
  cost?: number; // Price for auto-expense
  isImportant?: boolean; // (6) Highlight
  bookingImage?: string; // (7) Base64 string for booking screenshot
  alternatives?: string[]; // (8) Backup plans
  isCompleted?: boolean; // (11) Completion status
  travelTime?: string; // (12) e.g. "15 min"
  travelMode?: 'walking' | 'transit'; // (12)
  lat?: number;
  lng?: number;
  bookingDetails?: BookingDetails; // New: Specialized info for Bookings tab
}

export interface DayPlan {
  date: string; // ISO date string
  items: ItineraryItem[];
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  category?: string; // e.g. "Documents", "Clothing"
}

export interface WeatherInfo {
  summary: string;
  tempRange: string;
  rainChance: string;
}

export interface EmergencyInfo {
    police: string;
    ambulance: string;
    embassy: string;
    hospital: string;
}

export interface TravelTip {
    category: 'taboo' | 'visa' | 'network' | 'other';
    content: string;
}

export interface Voucher {
    id: string;
    title: string;
    image: string; // Base64 (DataURL)
    fileType?: 'image' | 'pdf';
    fileName?: string;
    date: string;
}

// --- New Types for AI Guide ---

export interface GuideAttraction {
    name: string;
    description: string; // Deep history/story
    photoSpots: string[]; // Specific spots for photos
    restroomTip?: string; // e.g. "Free restrooms at 2F"
    locationQuery: string;
    tags?: string[]; // "必去", "古蹟"
}

export interface GuideRestaurant {
    name: string;
    rating: string; // e.g. "4.5"
    mustOrder: string[]; // Highlighted menu items
    description: string;
    locationQuery: string;
    type?: string; // "Cafe", "Dinner"
}

export interface AdvancedGuide {
    attractions: GuideAttraction[];
    restaurants: GuideRestaurant[]; // Top 10
    hiddenGems: GuideAttraction[];
}

export interface Trip {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  duration: number;
  coverImage?: string;
  currencyCode: string; // e.g., JPY, USD
  exchangeRate: number; // e.g., 1 TWD = X Foreign (Note: Usually kept as TWD/Foreign or Foreign/TWD depending on logic, here assume 1 TWD = X Foreign for initial fetch, but expense uses Foreign -> TWD rate usually)
  budget: number; // Total Budget
  budgets: Budget[]; // Category breakdown
  expenses: Expense[];
  itinerary: DayPlan[];
  checklist: ChecklistItem[];
  weather?: WeatherInfo;
  dailyWeather?: string[]; // Array of weather strings corresponding to days
  notes: string;
  guideContent?: string; // Markdown content from AI (Legacy)
  
  // Info Tab Extensions
  emergency?: EmergencyInfo;
  tips?: TravelTip[];
  vouchers?: Voucher[];
  memo?: string;

  // New: Advanced Guide Data
  advancedGuide?: AdvancedGuide;
}

export enum Tab {
  ITINERARY = 'itinerary',
  EXPENSE = 'expense',
  INFO = 'info',
  GUIDE = 'guide',
}