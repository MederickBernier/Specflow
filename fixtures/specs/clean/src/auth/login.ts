export function login(email: string, password: string): boolean {
  return email.length > 0 && password === "secret";
}
