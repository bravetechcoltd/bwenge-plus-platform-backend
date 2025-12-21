// @ts-nocheck
import { User } from "../database/models/User";

export const excludePassword = (user: User | null) => {
  if (!user) return null;
  const { password, resetPasswordExpires, resetPasswordToken, firstLogin, isEmailVerified, preferredLanguage, theme, notificationSettings, disabled, signUrl, twostepv, isActive, ...userWithoutPassword } = user;
  return userWithoutPassword;
};