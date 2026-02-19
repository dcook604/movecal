import { UserRole } from '@prisma/client';

export type AuthUser = {
  id: string;
  role: UserRole;
  email: string;
  name: string;
};
