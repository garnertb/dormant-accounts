---
applyTo: '**/*.ts'
---

# Project coding standards for TypeScript

- Use TypeScript for all new code
- Follow functional programming principles where possible
- Use interfaces for data structures and type definitions
- Prefer immutable data (const, readonly)
- Use optional chaining (?.) and nullish coalescing (??) operators
- Prefer destructuring for declaring variables and function parameters.
- Include TSDoc comments for all public functions and classes, include types in parameters and return types
- When implementing a request to a paginated GitHub API endpoint, use `octokit.paginate` interface to handle pagination
