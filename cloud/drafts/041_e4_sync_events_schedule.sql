-- Hosted projects only, after 041 and with pg_cron installed.
select cron.schedule('shoppingapp-expire-e4-feed-semantics','17 * * * *',
  'select shoppingapp_internal.expire_e4_feed_semantics();');
