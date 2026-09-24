import Testing
@testable import DragonAcademy

@Test func rawNonceHasTheRequestedLengthFromTheAlphabet() {
    let nonce = Nonce.random(length: 48)
    #expect(nonce.count == 48)
    #expect(nonce.allSatisfy(Nonce.alphabet.contains))
    #expect(Nonce.random().count == 32)
}

@Test func rawNoncesDoNotRepeat() {
    let nonces = Set((0..<200).map { _ in Nonce.random() })
    #expect(nonces.count == 200)
}

@Test func alphabetIsSixtyFourDistinctURLSafeCharacters() {
    #expect(Nonce.alphabet.count == 64)
    #expect(Set(Nonce.alphabet).count == 64)
}

/// Must match the server, which compares the token's nonce claim to
/// sha256(raw) as lowercase hex (server/lib/appleIdentity.js).
@Test func hashIsLowercaseHexSHA256() {
    #expect(Nonce.sha256Hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    #expect(Nonce.sha256Hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
}
