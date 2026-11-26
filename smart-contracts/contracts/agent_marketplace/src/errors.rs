//! # Error Types for Agent Marketplace

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    Unauthorized = 2,
    AlreadyExists = 3,
    ContractPaused = 4,
    InvalidPrice = 5,
    InsufficientPayment = 6,
    BookingNotFound = 7,
    BookingAlreadyCompleted = 8,
    BookingAlreadyCancelled = 9,
    SlaViolation = 10,
    NotOwner = 11,
    ServiceNotAvailable = 12,
    InvalidAuctionDuration = 13,
    AuctionTokenNotConfigured = 14,
    BidTooLow = 15,
    AuctionExpired = 16,
    AuctionNotExpired = 17,
    AuctionAlreadyFinalized = 18,
    AuctionIdExhausted = 19,
}

impl Error {
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            1 => Some(Error::NotFound),
            2 => Some(Error::Unauthorized),
            3 => Some(Error::AlreadyExists),
            4 => Some(Error::ContractPaused),
            5 => Some(Error::InvalidPrice),
            6 => Some(Error::InsufficientPayment),
            7 => Some(Error::BookingNotFound),
            8 => Some(Error::BookingAlreadyCompleted),
            9 => Some(Error::BookingAlreadyCancelled),
            10 => Some(Error::SlaViolation),
            11 => Some(Error::NotOwner),
            12 => Some(Error::ServiceNotAvailable),
            13 => Some(Error::InvalidAuctionDuration),
            14 => Some(Error::AuctionTokenNotConfigured),
            15 => Some(Error::BidTooLow),
            16 => Some(Error::AuctionExpired),
            17 => Some(Error::AuctionNotExpired),
            18 => Some(Error::AuctionAlreadyFinalized),
            19 => Some(Error::AuctionIdExhausted),
            _ => None,
        }
    }
}
