INSERT INTO roles (name, description)
VALUES
  ('STUDENT', 'Student role in an organization.'),
  ('TEACHER', 'Teacher role in an organization.'),
  ('PARENT', 'Parent role in an organization.'),
  ('SCHOOL_ADMIN', 'School administrator role in a school organization.'),
  ('COACHING_ADMIN', 'Coaching center administrator role in a coaching organization.')
ON CONFLICT (name) DO NOTHING;
