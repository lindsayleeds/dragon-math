// Where a logged-in user belongs after entering. Kids (and guests) go to the
// map; parents/teachers to their dashboards.
export function homePathFor(user) {
  if (user?.account_type !== 'parent') return '/map';
  return user?.adult_role === 'teacher' ? '/teacher' : '/parent';
}
