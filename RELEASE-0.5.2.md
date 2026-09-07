UniDesk 0.5.2

- Course navigation now uses five main sections: Overview, Materials, Assessments, Study, and Emails. Related views appear in a second row; all existing course tools remain accessible.
- Database migration 13 transfers previously saved sender-to-course mappings into the Instructor Directory. Existing instructor records and course links are preserved, with a database backup before upgrading version 12.
- Opening Emails or saving instructor links rematches cached messages using the current directory and course codes. This does not require another mailbox download. Manual course assignments and reviewed academic changes are preserved.
- Course Emails includes a collapsed Manage course instructors control, with the current course selected when adding an instructor.

Validation: 67 Node tests, 32 Rust tests, TypeScript/production build, and a browser workflow covering every grouped view, cached mail assignment after instructor save, and navigation widths of 1024, 1440, and 2560 pixels.

Install using D:\App\UniDesk-Setup.exe. Existing workspace data is upgraded in place.
