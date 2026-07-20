// Where a logged-in user belongs after entering. Kids (and guests) land on the
// home hub (which leads to the Adventure Map); parents/teachers to dashboards.
export function homePathFor(user) {
  if (user?.account_type !== 'parent') return '/home';
  return user?.adult_role === 'teacher' ? '/teacher' : '/parent';
}
