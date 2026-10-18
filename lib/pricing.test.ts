import { describe, expect, it } from "vitest";
import { place, range } from "@/test/fixtures";
import { ticketPrice } from "./pricing";

describe("ticketPrice", () => {
  const ministry = place({ price: range(500), muzekart: true });
  const palace = place({ price: range(250) });

  it("Müzekart geçen yer, kartı olana ücretsiz", () => {
    expect(ticketPrice(ministry, { hasMuzekart: true })).toMatchObject({ min: 0, max: 0 });
    expect(ticketPrice(ministry, { hasMuzekart: false })).toMatchObject({ min: 500, max: 500 });
    expect(ticketPrice(ministry, {})).toMatchObject({ min: 500, max: 500 });
  });

  it("Müzekart geçmeyen yer (ör. Millî Saraylar) her durumda ücretli", () => {
    expect(ticketPrice(palace, { hasMuzekart: true })).toMatchObject({ min: 250, max: 250 });
  });
});
