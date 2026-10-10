export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailDriver {
  send(msg: OutgoingEmail): Promise<void>;
}
