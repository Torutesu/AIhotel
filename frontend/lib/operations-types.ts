/** Operations identities are separate from hotel tenant roles. Never grant agency users PLATFORM_ADMIN. */
export interface OperationsIdentity { id: string; role: 'PLATFORM_ADMIN' | 'AGENCY'; name: string; email: string }
export interface AgencyAccount { id: string; name: string; email: string; active: boolean; createdAt: string }
export interface OperationsCustomer { id: string; name: string; hotelName: string; email: string; note: string; agencyId: string | null; createdAt: string }
