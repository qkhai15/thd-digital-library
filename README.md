# 📚 Tran Hung Dao – Thanh Xuan High School Digital Library

A digital library platform developed for **Tran Hung Dao – Thanh Xuan High School, Hanoi, Vietnam**, designed to modernize library management and provide convenient access to educational resources for students and teachers.

🌐 **Official Website:** https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn

## About the Project

The Digital Library is a web-based platform that helps students, teachers, and library administrators discover, access, organize, and manage educational resources.

The system supports multiple content formats, online document viewing, book borrowing management, and administrative workflows.

Built with modern web technologies, the platform is designed to be responsive, maintainable, secure, and accessible across desktop and mobile devices.

## Key Features

### For Students and Teachers

- Browse and search the library catalog.
- Access printed books, e-books, audiobooks, videos, photo albums, and other educational materials.
- Read PDF documents directly in the browser.
- Stream supported audio and video content.
- View document information and engagement statistics.
- Submit book borrowing requests.
- Explore school news and library activities.

### Feature Upgrade (In Development)

The `feature-upgrade` branch introduces additional capabilities that are undergoing final verification and release preparation:

- **Advanced Search:** Search suggestions, filtering, and sorting.
- **Document Classification:** Organize materials by subject, grade, topic, and tags.
- **Collections:** Curated educational resource collections.
- **Related Documents:** Discover relevant learning materials.
- **QR Codes:** Generate document-specific QR codes for sharing.
- **Bookmarks:** Save documents for later.
- **Recently Viewed:** Quickly revisit previously accessed materials.
- **Borrowing Workflow:** Manage approval, pickup, borrowing, and returns.
- **Inventory Management:** Maintain consistent book availability.
- **Admin Analytics:** Monitor library activity and usage statistics.
- **Publishing Workflow:** Manage draft, review, published, and archived content.

These features should not be considered deployed to production until the release and verification process is complete.

## Administration

The administration dashboard supports:

- Document and metadata management.
- File uploads and media management.
- Book inventory tracking.
- Borrowing request management.
- News and content publishing.
- Comment moderation.
- Library settings and configuration.
- Activity logs and operational monitoring.

Administrative operations require authentication and appropriate authorization.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Backend | Next.js App Router, API Routes |
| Database | PostgreSQL |
| Database Driver | `pg` |
| Managed Database | Supabase PostgreSQL |
| File Storage | Supabase Storage |
| Hosting | Railway |
| Containerization | Docker |
| PDF Viewer | PDF.js |
| Version Control | Git & GitHub |

## Getting Started

### Prerequisites

- Node.js and npm
- A dedicated development PostgreSQL database
- Required environment variables

### Installation

**1. Clone the repository**

`git clone https://github.com/qkhai15/thd-digital-library.git`

`cd thd-digital-library`

**2. Switch to the development branch**

`git switch feature-upgrade`

**3. Install dependencies**

`npm ci`

**4. Configure environment variables**

Create a local `.env.local` file using `.env.example` as a reference.

Use development credentials and a dedicated development database. Never use production credentials for local experimentation.

**5. Run database migrations**

After configuring a safe development database:

`npm run db:migrate`

**6. Start the development server**

`npm run dev`

Open http://localhost:3000 in your browser.

## Testing

The project includes automated tests for application functionality, database integration, security-related behavior, and regression prevention.

**Run the test suite**

`npm test`

**TypeScript validation**

`npx tsc --noEmit`

**Lint**

`npm run lint`

**Production build verification**

`npm run build`

**PostgreSQL integration tests**

`npm run test:postgres`

Database-related tests must use an appropriately isolated environment.

Test results should be reverified against the current code before every production release.

## Deployment Status

### Production Website

The existing website is deployed on Railway with PostgreSQL and Supabase Storage.

**Production URL:** https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn

### Development Branch

The `feature-upgrade` branch contains the next generation of library features.

Development code is not automatically considered production-ready.

Before deployment, the release process requires:

- Successful automated and browser-based testing.
- Verified database backups and recovery procedures.
- Safe, tested database migrations.
- Preservation of existing records and uploaded files.
- Docker and runtime verification.
- Production health checks and regression testing.

Pushing source code to GitHub does not necessarily update the production website.

## Security

Security is an important part of this project.

The application uses environment-based configuration, authenticated administration, and controlled access to storage resources.

Sensitive information must never be committed to this repository, including:

- Passwords and API keys.
- Production database connection strings.
- Session signing secrets.
- Storage access credentials.
- Database backups.
- Encryption and recovery keys.
- Private user information.

Production credentials and operational data are maintained separately from public source code.

## Project Documentation

Additional documentation is available in the `deploy` directory:

- [Feature Documentation](deploy/FEATURES.md)
- [Operations Guide](deploy/OPERATIONS.md)
- [Database Migration Guide](deploy/DATABASE-MIGRATION.md)
- [Storage Migration Guide](deploy/STORAGE-MIGRATION.md)

## Future Development

The project aims to continuously improve:

- Educational resource discovery.
- User experience and accessibility.
- Library administration efficiency.
- Search relevance and content organization.
- System reliability and monitoring.
- Data protection and backup procedures.

## Project Information

**Project:** Digital Library Management System

**Institution:** Tran Hung Dao – Thanh Xuan High School

**Location:** Hanoi, Vietnam

**Official Website:** https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn

**Repository:** https://github.com/qkhai15/thd-digital-library

---

Developed to support digital transformation and educational resource accessibility at Tran Hung Dao – Thanh Xuan High School.
