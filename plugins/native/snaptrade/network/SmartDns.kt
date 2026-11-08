package com.oxsabbir.snaptrade.network

import java.net.Inet4Address
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import okhttp3.Dns

/**
 * DNS for the app's socket dials, hardened against carrier behaviour (Grameenphone mobile
 * data in the field):
 *
 *  - IPv4 answers are ordered before IPv6 — the carrier's v6 route has been observed dead
 *    while v4 was open, and OkHttp otherwise tries addresses in resolver order.
 *  - The last address per hostname that actually completed a connection is remembered and
 *    tried first — one resolver answer being blackholed must not be the first candidate of
 *    every retry; once an address has proven itself it goes to the front of the line.
 *  - If resolution itself fails, a known-good cached address is returned instead of throwing.
 */
object SmartDns : Dns {
  private val lastGood = ConcurrentHashMap<String, InetAddress>()

  override fun lookup(hostname: String): List<InetAddress> {
    val resolved: List<InetAddress> = try {
      Dns.SYSTEM.lookup(hostname)
    } catch (e: UnknownHostException) {
      val knownGood = lastGood[hostname]
      if (knownGood != null) {
        listOf(knownGood)
      } else {
        throw e
      }
    }
    if (resolved.size <= 1) return resolved

    val preferred = lastGood[hostname]
    return buildList {
      if (preferred != null) add(preferred)
      for (address in resolved) {
        if (address is Inet4Address && address != preferred) add(address)
      }
      for (address in resolved) {
        if (address !is Inet4Address && address != preferred) add(address)
      }
    }
  }

  /** Called from the OkHttp event listener on a successfully acquired connection. */
  fun recordSuccess(hostname: String, address: InetAddress) {
    lastGood[hostname] = address
  }
}
