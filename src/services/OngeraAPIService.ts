import axios from 'axios';

export class OngeraAPIService {
  private static baseURL = process.env.ONGERA_API_URL;
  private static sharedSecret = process.env.SSO_SHARED_SECRET;

  static async validateSSOToken(token: string) {
    const response = await axios.post(
      `${this.baseURL}/auth/sso/validate-token`,
      { sso_token: token },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.sharedSecret}`
        },
        timeout: 5000
      }
    );
    return response.data;
  }

  static async consumeSSOToken(token: string) {
    const response = await axios.post(
      `${this.baseURL}/auth/sso/consume-token`,
      { sso_token: token },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );
    return response.data;
  }

  static async triggerOngeraLogout(userId: string) {
    await axios.post(
      `${this.baseURL}/auth/sso/terminate-session`,
      {
        user_id: userId,
        system: "ONGERA"
      },
      {
        headers: {
          'Authorization': `Bearer ${this.sharedSecret}`
        }
      }
    );
  }

  static async checkOngeraSession(userId: string) {
    const response = await axios.get(
      `${this.baseURL}/auth/sso/validate-session`,
      {
        headers: {
          'Authorization': `Bearer ${this.sharedSecret}`
        },
        params: { user_id: userId }
      }
    );
    return response.data;
  }
}