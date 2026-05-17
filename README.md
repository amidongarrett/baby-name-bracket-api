# Baby Name Bracket API

Express backend server for the Baby Name Bracket Championship application.

## Overview

This is a standalone Node.js/Express API server that provides RESTful endpoints for managing bracket sessions and name submissions. It's designed to work with the Next.js frontend running on port 3000.

## Features

- ✅ **Express Server** with clean baseline setup
- ✅ **CORS Enabled** to accept requests from port 3000 frontend
- ✅ **Health Check Endpoint** (`GET /health`) for verification
- ✅ **Environment Configuration** with dotenv
- ✅ **Error Handling** with global error middleware
- ✅ **Request Logging** in development mode
- ✅ **Graceful Shutdown** handling

## Tech Stack

- **Runtime**: Node.js (v18+ LTS)
- **Framework**: Express.js v5
- **Middleware**: cors, dotenv, express-validator
- **Database**: Mongoose (ready for MongoDB integration)
- **Dev Tools**: nodemon for hot-reload

## Project Structure

```
baby-name-bracket-api/
├── server.js              # Main entry point (Express app)
├── package.json           # Dependencies and scripts
├── .env                   # Environment variables (gitignored)
├── .env.example          # Environment template
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

## Prerequisites

- Node.js v18 or higher
- npm or yarn package manager

## Installation

1. **Navigate to the API directory**:
   ```bash
   cd baby-name-bracket-api
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   
   The default `.env` file is already configured for local development:
   ```env
   NODE_ENV=development
   PORT=3001
   FRONTEND_URL=http://localhost:3000
   CORS_ORIGIN=http://localhost:3000
   ```

## Running the Server

### Development Mode (with hot-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The server will start on **port 3001** by default.

## API Endpoints

### Health Check
```bash
GET http://localhost:3001/health
```

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2026-05-16T17:00:00.000Z",
  "version": "1.0.0",
  "environment": "development",
  "port": 3001
}
```

### Root Endpoint
```bash
GET http://localhost:3001/
```

**Response**:
```json
{
  "message": "Baby Name Bracket API",
  "version": "1.0.0",
  "endpoints": {
    "health": "/health",
    "api": "/api"
  }
}
```

### API Info
```bash
GET http://localhost:3001/api
```

**Response**:
```json
{
  "message": "Baby Name Bracket API v1.0.0",
  "endpoints": {
    "brackets": "/api/brackets",
    "names": "/api/brackets/:sessionId/names"
  },
  "documentation": "See plans/backend-architecture-spec.md"
}
```

## Testing the Server

### Using curl
```bash
# Health check
curl http://localhost:3001/health

# API info
curl http://localhost:3001/api
```

### Using Browser
Open your browser and navigate to:
- http://localhost:3001/health
- http://localhost:3001/

### Testing CORS
The server is configured to accept requests from:
- `http://localhost:3000` (Next.js frontend)
- `http://localhost:3001` (self)
- `http://127.0.0.1:3000` (alternative localhost)

## CORS Configuration

The server uses dynamic CORS configuration to allow specific origins:

```javascript
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      process.env.FRONTEND_URL
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (development/production) | `development` |
| `PORT` | Server port | `3001` |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:3000` |

## Development Workflow

1. **Start the backend** (port 3001):
   ```bash
   cd baby-name-bracket-api
   npm run dev
   ```

2. **Start the frontend** (port 3000) in a separate terminal:
   ```bash
   cd baby-name-bracket-app
   npm run dev
   ```

3. **Verify connection**:
   - Backend: http://localhost:3001/health
   - Frontend: http://localhost:3000

## Next Steps

See the [Backend Architecture Specification](../plans/backend-architecture-spec.md) for the complete implementation plan:

- [ ] Add MongoDB connection
- [ ] Implement Bracket model with Mongoose
- [ ] Create bracket CRUD endpoints
- [ ] Implement name submission logic
- [ ] Add validation middleware
- [ ] Integrate with frontend
- [ ] Add authentication
- [ ] Deploy to Azure

## Error Handling

The server includes comprehensive error handling:

- **404 Not Found**: Unmatched routes
- **403 CORS Error**: Origin not allowed
- **500 Internal Server Error**: Unexpected errors

All errors return JSON with:
```json
{
  "error": "Error Type",
  "message": "Error description",
  "timestamp": "2026-05-16T17:00:00.000Z"
}
```

## Troubleshooting

### Port Already in Use
If port 3001 is already in use:
```bash
# Find process using port 3001
lsof -i :3001

# Kill the process (replace PID)
kill -9 <PID>

# Or change the port in .env
PORT=3002
```

### CORS Errors
Ensure the frontend URL matches in `.env`:
```env
FRONTEND_URL=http://localhost:3000
```

### Module Not Found
Reinstall dependencies:
```bash
npm install
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start server in production mode |
| `npm run dev` | Start server with nodemon (hot-reload) |
| `npm test` | Run tests (placeholder) |

## License

ISC

## Documentation

For complete API documentation, see:
- [Backend Architecture Specification](../plans/backend-architecture-spec.md)
- [Portfolio Architecture Specification](../plans/portfolio-architecture-spec.md)

---

**Built with ❤️ for the Baby Name Bracket Championship**
