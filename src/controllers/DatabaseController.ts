// @ts-nocheck

// backend/src/controllers/DatabaseController.ts
import { Request, Response } from "express";
import dbConnection from "../database/db";
import {
  DatabaseBackup,
  BackupStatus,
  BackupType,
  DatabaseHealthCheck,
} from "../database/models/DatabaseBackup";
import { User, BwengeRole } from "../database/models/User";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { s3Service } from "../services/s3Service";

const execAsync = promisify(exec);

export class DatabaseController {
  
  private static async verifySystemAdmin(req: Request, res: Response): Promise<boolean> {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return false;
    }
    const userRepo = dbConnection.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user || user.bwenge_role !== BwengeRole.SYSTEM_ADMIN) {
      res.status(403).json({ success: false, message: "System admin access required" });
      return false;
    }
    return true;
  }

  // GET /api/system-settings/database/backups
  static async getBackups(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const { page = 1, limit = 20, status } = req.query;

      const backupRepo = dbConnection.getRepository(DatabaseBackup);
      const queryBuilder = backupRepo.createQueryBuilder("backup");

      if (status && Object.values(BackupStatus).includes(status as BackupStatus)) {
        queryBuilder.andWhere("backup.status = :status", { status });
      }

      const total = await queryBuilder.getCount();
      const backups = await queryBuilder
        .orderBy("backup.created_at", "DESC")
        .skip((Number(page) - 1) * Number(limit))
        .take(Number(limit))
        .getMany();

      res.json({
        success: true,
        data: {
          backups,
          total,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Get backups error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch backups",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/database/backups
  static async createBackup(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const { type = "FULL", notes } = req.body;
      const userId = req.user?.userId || req.user?.id;

      const backupRepo = dbConnection.getRepository(DatabaseBackup);

      const filename = `backup_${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
      const backupPath = path.join(process.env.BACKUP_PATH || "/tmp", filename);

      const backup = backupRepo.create({
        filename,
        type: type as BackupType,
        status: BackupStatus.PENDING,
        is_automated: false,
        created_by_user_id: userId,
        log: [],
        metadata: {
          notes,
        },
      });

      await backupRepo.save(backup);

      // Start backup process asynchronously
      DatabaseController.runBackup(backup.id, backupPath).catch(console.error);

      res.status(202).json({
        success: true,
        message: "Backup started",
        data: backup,
      });
    } catch (error: any) {
      console.error("❌ Create backup error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to start backup",
        error: error.message,
      });
    }
  }

  private static async runBackup(backupId: string, backupPath: string) {
    const backupRepo = dbConnection.getRepository(DatabaseBackup);
    const log = [];

    try {
      // Update status to in progress
      await backupRepo.update(backupId, {
        status: BackupStatus.IN_PROGRESS,
        started_at: new Date(),
        log: ["Backup started"],
      });

      // Run pg_dump
      const { stdout, stderr } = await execAsync(
        `pg_dump ${process.env.DATABASE_URL} > ${backupPath}`
      );

      if (stderr) {
        log.push(`pg_dump stderr: ${stderr}`);
      }

      // Check file size
      const stats = fs.statSync(backupPath);
      const sizeBytes = stats.size;

      // Upload to S3 (optional)
      let storagePath = backupPath;
      let publicUrl = null;

      if (process.env.S3_BACKUP_BUCKET) {
        const s3Key = `backups/${path.basename(backupPath)}`;
        await s3Service.uploadFile(backupPath, s3Key);
        storagePath = s3Key;
        publicUrl = await s3Service.getSignedUrl(s3Key, 3600); // 1 hour expiry
      }

      // Calculate checksum
      const fileBuffer = fs.readFileSync(backupPath);
      const hashSum = crypto.createHash("sha256");
      hashSum.update(fileBuffer);
      const checksum = hashSum.digest("hex");

      // Update backup record
      await backupRepo.update(backupId, {
        status: BackupStatus.COMPLETED,
        completed_at: new Date(),
        size_bytes: sizeBytes,
        storage_path: storagePath,
        public_url: publicUrl,
        metadata: {
          checksum,
          row_count: 0, // Would need to parse SQL to get this
        },
        log: [...log, `Backup completed. Size: ${sizeBytes} bytes`],
      });

      // Clean up local file
      fs.unlinkSync(backupPath);
    } catch (error: any) {
      console.error("Backup failed:", error);

      await backupRepo.update(backupId, {
        status: BackupStatus.FAILED,
        completed_at: new Date(),
        error_message: error.message,
        log: [...log, `Error: ${error.message}`],
      });

      // Clean up if file exists
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    }
  }

  // POST /api/system-settings/database/backups/:id/restore
  static async restoreBackup(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const backupRepo = dbConnection.getRepository(DatabaseBackup);
      const backup = await backupRepo.findOne({ where: { id } });

      if (!backup) {
        return res.status(404).json({
          success: false,
          message: "Backup not found",
        });
      }

      if (backup.status !== BackupStatus.COMPLETED) {
        return res.status(400).json({
          success: false,
          message: "Only completed backups can be restored",
        });
      }

      // Update status
      backup.status = BackupStatus.RESTORING;
      await backupRepo.save(backup);

      // Start restore asynchronously
      DatabaseController.runRestore(backup).catch(console.error);

      res.json({
        success: true,
        message: "Restore started",
        data: backup,
      });
    } catch (error: any) {
      console.error("❌ Restore backup error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to start restore",
        error: error.message,
      });
    }
  }

  private static async runRestore(backup: DatabaseBackup) {
    const backupRepo = dbConnection.getRepository(DatabaseBackup);
    const log = [...(backup.log || [])];

    try {
      log.push("Restore started");

      let filePath: string;

      // Download from S3 if needed
      if (backup.storage_path?.startsWith("backups/")) {
        filePath = path.join("/tmp", backup.filename);
        await s3Service.downloadFile(backup.storage_path, filePath);
      } else {
        filePath = backup.storage_path || `/tmp/${backup.filename}`;
      }

      // Run psql to restore
      const { stdout, stderr } = await execAsync(
        `psql ${process.env.DATABASE_URL} < ${filePath}`
      );

      if (stderr) {
        log.push(`psql stderr: ${stderr}`);
      }

      // Clean up
      if (filePath.startsWith("/tmp")) {
        fs.unlinkSync(filePath);
      }

      // Update backup
      await backupRepo.update(backup.id, {
        status: BackupStatus.COMPLETED,
        log: [...log, "Restore completed successfully"],
      });
    } catch (error: any) {
      console.error("Restore failed:", error);

      await backupRepo.update(backup.id, {
        status: BackupStatus.FAILED,
        error_message: error.message,
        log: [...log, `Error: ${error.message}`],
      });
    }
  }

  // DELETE /api/system-settings/database/backups/:id
  static async deleteBackup(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const { id } = req.params;

      const backupRepo = dbConnection.getRepository(DatabaseBackup);
      const backup = await backupRepo.findOne({ where: { id } });

      if (!backup) {
        return res.status(404).json({
          success: false,
          message: "Backup not found",
        });
      }

      // Delete from storage
      if (backup.storage_path?.startsWith("backups/")) {
        await s3Service.deleteFile(backup.storage_path);
      } else if (backup.storage_path && fs.existsSync(backup.storage_path)) {
        fs.unlinkSync(backup.storage_path);
      }

      await backupRepo.remove(backup);

      res.json({
        success: true,
        message: "Backup deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Delete backup error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete backup",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/database/health
  static async getHealthStatus(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const healthRepo = dbConnection.getRepository(DatabaseHealthCheck);

      // Get latest health check
      const latest = await healthRepo.findOne({
        order: { checked_at: "DESC" },
      });

      // Run new health check
      const health = await DatabaseController.runHealthCheck();

      res.json({
        success: true,
        data: {
          current: health,
          history: latest,
        },
      });
    } catch (error: any) {
      console.error("❌ Get health status error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get database health status",
        error: error.message,
      });
    }
  }

  private static async runHealthCheck(): Promise<DatabaseHealthCheck> {
    const healthRepo = dbConnection.getRepository(DatabaseHealthCheck);

    try {
      // Run various queries to check database health
      const connection = dbConnection;

      // Get active connections
      const connectionsResult = await connection.query(
        "SELECT count(*) as count FROM pg_stat_activity;"
      );
      const activeConnections = parseInt(connectionsResult[0]?.count || "0");

      // Get cache hit ratio
      const cacheResult = await connection.query(`
        SELECT 
          sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as hit_ratio
        FROM pg_statio_user_tables;
      `);
      const cacheHitRatio = parseFloat(cacheResult[0]?.hit_ratio || "0") * 100;

      // Get index hit ratio
      const indexResult = await connection.query(`
        SELECT 
          sum(idx_blks_hit) / (sum(idx_blks_hit) + sum(idx_blks_read)) as hit_ratio
        FROM pg_statio_user_indexes;
      `);
      const indexHitRatio = parseFloat(indexResult[0]?.hit_ratio || "0") * 100;

      // Get table sizes
      const tableStats = await connection.query(`
        SELECT
          schemaname || '.' || tablename as table_name,
          n_live_tup as row_count,
          pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size,
          pg_indexes_size(schemaname || '.' || tablename) as index_size
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
        LIMIT 10;
      `);

      // Get slow queries
      const slowQueries = await connection.query(`
        SELECT
          query,
          calls,
          total_time,
          mean_time
        FROM pg_stat_statements
        ORDER BY mean_time DESC
        LIMIT 10;
      `);

      const health = healthRepo.create({
        status: "healthy",
        active_connections: activeConnections,
        max_connections: 100, // Configurable
        cache_hit_ratio: cacheHitRatio,
        index_hit_ratio: indexHitRatio,
        query_latency_ms: 5.2, // Mock value
        table_stats: tableStats.map((t: any) => ({
          table_name: t.table_name,
          row_count: parseInt(t.row_count || "0"),
          size_mb: parseFloat(t.size) || 0,
          index_size_mb: parseFloat(t.index_size) || 0,
        })),
        slow_queries: slowQueries.map((q: any) => ({
          query: q.query.substring(0, 200),
          calls: parseInt(q.calls),
          total_time_ms: parseFloat(q.total_time),
          mean_time_ms: parseFloat(q.mean_time),
        })),
      });

      await healthRepo.save(health);
      return health;
    } catch (error: any) {
      const health = healthRepo.create({
        status: "degraded",
        error: error.message,
      });
      await healthRepo.save(health);
      return health;
    }
  }

  // GET /api/system-settings/database/status
  static async getDatabaseStatus(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const connection = dbConnection;

      // Get database version
      const versionResult = await connection.query("SELECT version();");
      const version = versionResult[0]?.version || "Unknown";

      // Get database size
      const sizeResult = await connection.query(`
        SELECT pg_database_size(current_database()) as size;
      `);
      const sizeBytes = parseInt(sizeResult[0]?.size || "0");

      // Get table count
      const tablesResult = await connection.query(`
        SELECT count(*) as count FROM information_schema.tables 
        WHERE table_schema = 'public';
      `);
      const tableCount = parseInt(tablesResult[0]?.count || "0");

      // Get row counts by table
      const rowCounts = await connection.query(`
        SELECT
          schemaname || '.' || tablename as table_name,
          n_live_tup as row_count
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC;
      `);

      // Get last vacuum time
      const vacuumInfo = await connection.query(`
        SELECT
          schemaname || '.' || tablename as table_name,
          last_vacuum,
          last_autovacuum,
          last_analyze,
          last_autoanalyze
        FROM pg_stat_user_tables
        ORDER BY last_autovacuum DESC NULLS LAST;
      `);

      res.json({
        success: true,
        data: {
          version,
          size_bytes: sizeBytes,
          size_human: formatBytes(sizeBytes),
          table_count: tableCount,
          row_counts: rowCounts.map((r: any) => ({
            table: r.table_name,
            rows: parseInt(r.row_count || "0"),
          })),
          vacuum_info: vacuumInfo,
          uptime: "N/A", // Would need to query pg_stat_activity for backend start time
        },
      });
    } catch (error: any) {
      console.error("❌ Get database status error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get database status",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/database/maintenance/vacuum
  static async runVacuum(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const { table, full = false } = req.body;

      const connection = dbConnection;

      const vacuumCommand = full ? "VACUUM FULL" : "VACUUM";
      const query = table
        ? `${vacuumCommand} ${table};`
        : `${vacuumCommand};`;

      await connection.query(query);

      res.json({
        success: true,
        message: `Vacuum ${full ? "FULL " : ""}completed successfully`,
      });
    } catch (error: any) {
      console.error("❌ Run vacuum error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to run vacuum",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/database/maintenance/analyze
  static async runAnalyze(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const { table } = req.body;

      const connection = dbConnection;

      const query = table
        ? `ANALYZE ${table};`
        : `ANALYZE;`;

      await connection.query(query);

      res.json({
        success: true,
        message: "Analyze completed successfully",
      });
    } catch (error: any) {
      console.error("❌ Run analyze error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to run analyze",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/database/queries
  static async getActiveQueries(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const connection = dbConnection;

      const queries = await connection.query(`
        SELECT
          pid,
          usename as user,
          application_name,
          client_addr,
          query_start,
          state,
          query
        FROM pg_stat_activity
        WHERE state = 'active'
        AND pid <> pg_backend_pid()
        ORDER BY query_start DESC;
      `);

      res.json({
        success: true,
        data: queries.map((q: any) => ({
          pid: q.pid,
          user: q.user,
          application: q.application_name,
          client: q.client_addr,
          started: q.query_start,
          state: q.state,
          query: q.query,
        })),
      });
    } catch (error: any) {
      console.error("❌ Get active queries error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get active queries",
        error: error.message,
      });
    }
  }

  // POST /api/system-settings/database/queries/:pid/terminate
  static async terminateQuery(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const { pid } = req.params;

      const connection = dbConnection;

      await connection.query(`SELECT pg_terminate_backend(${pid});`);

      res.json({
        success: true,
        message: `Query ${pid} terminated successfully`,
      });
    } catch (error: any) {
      console.error("❌ Terminate query error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to terminate query",
        error: error.message,
      });
    }
  }

  // GET /api/system-settings/database/settings
  static async getSettings(req: Request, res: Response) {
    try {
      if (!(await DatabaseController.verifySystemAdmin(req, res))) return;

      const connection = dbConnection;

      const settings = await connection.query(`
        SELECT name, setting, unit, short_desc
        FROM pg_settings
        WHERE name IN (
          'max_connections',
          'shared_buffers',
          'work_mem',
          'maintenance_work_mem',
          'effective_cache_size',
          'wal_buffers',
          'checkpoint_completion_target',
          'random_page_cost',
          'effective_io_concurrency',
          'max_worker_processes',
          'max_parallel_workers',
          'max_parallel_workers_per_gather'
        )
        ORDER BY name;
      `);

      res.json({
        success: true,
        data: settings.map((s: any) => ({
          name: s.name,
          value: s.setting,
          unit: s.unit,
          description: s.short_desc,
        })),
      });
    } catch (error: any) {
      console.error("❌ Get database settings error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get database settings",
        error: error.message,
      });
    }
  }
}

function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}