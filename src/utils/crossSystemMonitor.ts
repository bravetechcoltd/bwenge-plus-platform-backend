export class CrossSystemMonitor {
  private static instance: CrossSystemMonitor;
  private logs: any[] = [];
  private maxLogs = 1000;

  private constructor() {}

  static getInstance(): CrossSystemMonitor {
    if (!CrossSystemMonitor.instance) {
      CrossSystemMonitor.instance = new CrossSystemMonitor();
    }
    return CrossSystemMonitor.instance;
  }

  logProtection(event: {
    userId: string;
    system: string;
    field: string;
    action: 'protected' | 'updated' | 'attempted_null';
    oldValue: any;
    newValue: any;
    timestamp: Date;
  }) {
    const logEntry = {
      ...event,
      timestamp: new Date().toISOString()
    };
    
    this.logs.unshift(logEntry);
    
    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    
    console.log(`🛡️ [PROTECTION LOG] ${event.field} ${event.action} for user ${event.userId}`);
    
    // Alert on critical protection events
    if (event.action === 'attempted_null' && 
        ['IsForWhichSystem', 'bwenge_role', 'primary_institution_id'].includes(event.field)) {
      this.sendAlert(`Critical field protection: ${event.field} for user ${event.userId}`);
    }
  }

  getLogs(limit = 50) {
    return this.logs.slice(0, limit);
  }

  getStats() {
    const last24Hours = this.logs.filter(log => 
      new Date(log.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
    );
    
    const byField = last24Hours.reduce((acc, log) => {
      acc[log.field] = (acc[log.field] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const byAction = last24Hours.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      totalProtections: this.logs.length,
      last24Hours: last24Hours.length,
      byField,
      byAction,
      recentProtections: this.logs.slice(0, 10)
    };
  }

  private sendAlert(message: string) {
    // Implement alerting (email, Slack, etc.)
    console.warn(`🚨 ALERT: ${message}`);
  }
}

// Export singleton instance
export const crossSystemMonitor = CrossSystemMonitor.getInstance();