# TypeScript Fixes for CourseController

## Issues to Fix:

1. **crypto import**: Change `import crypto from "crypto"` to `import * as crypto from "crypto"`
2. **Module | null**: Add null checks before using Module
3. **course_id type**: Ensure course_id is string, not string[]
4. **Lesson | null**: Add null checks before using Lesson
5. **|| and ?? mixing**: Add parentheses when mixing operators
6. **AssessmentType**: Cast string to AssessmentType enum

## Key Fixes Needed:

### 1. Fix crypto import (Line 15)
```typescript
// BEFORE:
import crypto from "crypto";

// AFTER:
import * as crypto from "crypto";
```

### 2. Fix course_id type issues
```typescript
// Ensure course_id is always string
const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
```

### 3. Fix Module null checks
```typescript
// BEFORE:
const module = await moduleRepo.findOne({ where: { id: moduleId } });
module.title = "something"; // Error if null

// AFTER:
const module = await moduleRepo.findOne({ where: { id: moduleId } });
if (!module) {
  return res.status(404).json({ success: false, message: "Module not found" });
}
module.title = "something";
```

### 4. Fix || and ?? mixing
```typescript
// BEFORE:
const value = a || b ?? c;

// AFTER:
const value = (a || b) ?? c;
// OR
const value = a || (b ?? c);
```

### 5. Fix AssessmentType casting
```typescript
// BEFORE:
assessment.type = "QUIZ"; // Error

// AFTER:
assessment.type = "QUIZ" as AssessmentType;
// OR
assessment.type = AssessmentType.QUIZ;
```
