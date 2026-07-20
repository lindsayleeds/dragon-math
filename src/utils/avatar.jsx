// Avatars are normally emojis rendered as inline text. Some are image assets
// (path strings beginning with "/"). This helper lets every render site stay
// `{renderAvatar(value)}` — images size to 1em so they scale with whatever
// font-size the surrounding span already uses for emoji.

export function isImageAvatar(value) {
  return typeof value === 'string' && value.startsWith('/');
}

export function renderAvatar(value, alt = 'avatar') {
  if (isImageAvatar(value)) {
    return (
      <img
        src={value}
        alt={alt}
        style={{
          width: '1em',
          height: '1em',
          objectFit: 'cover',
          borderRadius: '50%',
          verticalAlign: 'middle',
        }}
      />
    );
  }
  return value;
}
