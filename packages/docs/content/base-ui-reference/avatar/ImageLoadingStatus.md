```typescript
type ImageLoadingStatus = 'idle' | 'loading' | 'loaded' | 'error';
```

## Export Groups

- `Avatar.Root`: `Avatar.Root`, `Avatar.Root.State`, `Avatar.Root.Props`
- `Avatar.Image`: `Avatar.Image`, `Avatar.Image.State`, `Avatar.Image.Props`
- `Avatar.Fallback`: `Avatar.Fallback`, `Avatar.Fallback.State`, `Avatar.Fallback.Props`
- `Default`: `ImageLoadingStatus`, `AvatarRootState`, `AvatarRootProps`, `AvatarImageState`, `AvatarImageProps`, `AvatarFallbackState`, `AvatarFallbackProps`

## Canonical Types

Maps `Canonical`: `Alias` — Use Canonical when its namespace is already imported; otherwise use Alias.

- `Avatar.Root.State`: `AvatarRootState`
- `Avatar.Root.Props`: `AvatarRootProps`
- `Avatar.Image.State`: `AvatarImageState`
- `Avatar.Image.Props`: `AvatarImageProps`
- `Avatar.Fallback.State`: `AvatarFallbackState`
- `Avatar.Fallback.Props`: `AvatarFallbackProps`
