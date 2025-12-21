// backend/src/database/models/Permission.ts
export const PERMISSIONS = {
  // User Management
  'users.view': 'View Users',
  'users.create': 'Create Users',
  'users.edit': 'Edit Users',
  'users.delete': 'Delete Users',
  'users.manage_roles': 'Manage User Roles',
  
  // Institution Management
  'institutions.view': 'View Institutions',
  'institutions.create': 'Create Institutions',
  'institutions.edit': 'Edit Institutions',
  'institutions.delete': 'Delete Institutions',
  'institutions.manage_members': 'Manage Institution Members',
  
  // Course Management
  'courses.view': 'View Courses',
  'courses.create': 'Create Courses',
  'courses.edit': 'Edit Courses',
  'courses.delete': 'Delete Courses',
  'courses.publish': 'Publish Courses',
  'courses.approve': 'Approve Courses',
  
  // Content Management
  'content.view': 'View Content',
  'content.create': 'Create Content',
  'content.edit': 'Edit Content',
  'content.delete': 'Delete Content',
  'content.moderate': 'Moderate Content',
  
  // Enrollment Management
  'enrollments.view': 'View Enrollments',
  'enrollments.manage': 'Manage Enrollments',
  'enrollments.approve': 'Approve Enrollments',
  'enrollments.export': 'Export Enrollments',
  
  // Analytics
  'analytics.view': 'View Analytics',
  'analytics.export': 'Export Reports',
  'analytics.system': 'View System Analytics',
  
  // System Settings
  'settings.view': 'View Settings',
  'settings.edit': 'Edit Settings',
  'settings.security': 'Manage Security Settings',
  
  // Audit Logs
  'audit.view': 'View Audit Logs',
  'audit.export': 'Export Audit Logs',
  
  // Roles & Permissions
  'roles.view': 'View Roles',
  'roles.create': 'Create Roles',
  'roles.edit': 'Edit Roles',
  'roles.delete': 'Delete Roles',
  
  // API Access
  'api.keys': 'Manage API Keys',
  'api.access': 'API Access',
  
  // System Health
  'health.view': 'View System Health',
  'health.manage': 'Manage System Health',
};

export type Permission = keyof typeof PERMISSIONS;