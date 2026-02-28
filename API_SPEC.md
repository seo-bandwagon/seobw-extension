# API Specification: Page Captures

## Endpoint

```
POST https://api.seobandwagon.dev/v1/captures
```

## Authentication

Bearer token in header:
```
Authorization: Bearer <user_api_key>
```

## Request Body

```json
{
  "url": "string (required) - Full page URL",
  "title": "string (required) - Page title",
  "wordCount": "number (required)",
  "charCount": "number (required)",
  "sentenceCount": "number (required)",
  "readability": {
    "fleschKincaid": "number - Grade level (0-20+)",
    "fleschEase": "number - Reading ease score (0-100)"
  },
  "topWords": [
    {
      "word": "string",
      "count": "number"
    }
  ],
  "topPhrases": [
    {
      "phrase": "string",
      "count": "number"
    }
  ],
  "capturedAt": "string (ISO 8601 timestamp)"
}
```

## Response

### Success (201 Created)
```json
{
  "id": "uuid",
  "url": "https://example.com/page",
  "createdAt": "2026-02-27T21:06:00.000Z"
}
```

### Error (4xx/5xx)
```json
{
  "error": "string - Error message",
  "code": "string - Error code"
}
```

## Error Codes

- `401` - Invalid or missing API key
- `400` - Invalid request body
- `409` - Duplicate URL (already captured recently)
- `429` - Rate limit exceeded
- `500` - Server error

## Rate Limits

- 60 requests per minute per user
- 1000 requests per day per user

## Notes

- Duplicate URLs within 1 hour are rejected (409)
- topWords/topPhrases arrays limited to 20 items each
- URL normalized before storage (lowercase, trailing slash removed)
