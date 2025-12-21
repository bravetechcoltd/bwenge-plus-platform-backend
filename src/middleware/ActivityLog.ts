
import { ActivityLog } from "../database/models/ActivitiesModel";
import dbConnection from "../database/db";

export async function logActivity({
  userId,
  action,
  targetId,
  targetType,
  details,
}: {
  userId?: string;
  action: string;
  targetId?: string;
  targetType?: string;
  details?: string;
}) {
  const logRepo = dbConnection.getRepository(ActivityLog);
  const log = logRepo.create({
    user: userId ? ({ id: userId } as any) : null,
    userId: userId || null,
    action,
    targetId,
    targetType,
    details,
  });
  await logRepo.save(log);
}