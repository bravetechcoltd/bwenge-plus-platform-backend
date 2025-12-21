import dbConnection from "../database/db";
import { InstitutionMember } from "../database/models/InstitutionMember";

export interface SharedInstitutionResult {
  hasSharedInstitution: boolean;
  sharedInstitutionIds: string[];
}

/**
 * Check if two users share at least one institution membership
 */
export async function assertSameInstitution(
  userIdA: string,
  userIdB: string
): Promise<SharedInstitutionResult> {
  const memberRepo = dbConnection.getRepository(InstitutionMember);
  
  // Get all institutions for user A
  const userAMemberships = await memberRepo.find({
    where: { user_id: userIdA, is_active: true },
    select: ["institution_id"]
  });
  
  // Get all institutions for user B
  const userBMemberships = await memberRepo.find({
    where: { user_id: userIdB, is_active: true },
    select: ["institution_id"]
  });
  
  const userAInstitutionIds = new Set(userAMemberships.map(m => m.institution_id));
  const userBInstitutionIds = new Set(userBMemberships.map(m => m.institution_id));
  
  // Find shared institutions
  const sharedInstitutionIds: string[] = [];
  for (const instId of userAInstitutionIds) {
    if (userBInstitutionIds.has(instId)) {
      sharedInstitutionIds.push(instId);
    }
  }
  
  return {
    hasSharedInstitution: sharedInstitutionIds.length > 0,
    sharedInstitutionIds,
  };
}

/**
 * Verify user has membership in a specific institution
 */
export async function isMemberOfInstitution(
  userId: string,
  institutionId: string
): Promise<boolean> {
  const memberRepo = dbConnection.getRepository(InstitutionMember);
  const membership = await memberRepo.findOne({
    where: {
      user_id: userId,
      institution_id: institutionId,
      is_active: true,
    },
  });
  return !!membership;
}

/**
 * Verify user is admin of an institution
 */
export async function isInstitutionAdmin(
  userId: string,
  institutionId: string
): Promise<boolean> {
  const memberRepo = dbConnection.getRepository(InstitutionMember);
  const membership = await memberRepo.findOne({
    where: {
      user_id: userId,
      institution_id: institutionId,
      is_active: true,
    },
  });
  return membership?.role === "ADMIN";
}