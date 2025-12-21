
export function generateSlug(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    // Replace spaces with hyphens
    .replace(/\s+/g, '-')
    // Remove special characters
    .replace(/[^\w\-]+/g, '')
    // Replace multiple hyphens with single hyphen
    .replace(/\-\-+/g, '-')
    // Remove hyphens from start and end
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * Generate a unique slug by appending a random string if needed
 */
export function generateUniqueSlug(
  text: string,
  existingSlugs: string[],
  maxLength: number = 60
): string {
  let slug = generateSlug(text);
  
  // Truncate if too long
  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength).replace(/-+$/, '');
  }
  
  // Check if slug exists
  if (!existingSlugs.includes(slug)) {
    return slug;
  }
  
  // Append random string to make it unique
  const randomStr = Math.random().toString(36).substring(2, 6);
  const baseSlug = slug.substring(0, maxLength - 5).replace(/-+$/, '');
  return `${baseSlug}-${randomStr}`;
}

/**
 * Generate a slug from a title with date (for blog posts, news, etc.)
 */
export function generateDatedSlug(title: string, date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const slug = generateSlug(title);
  
  return `${year}/${month}/${day}/${slug}`;
}

/**
 * Extract title from a slug (reverse operation)
 */
export function slugToTitle(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}