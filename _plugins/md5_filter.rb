require "digest"

module Jekyll
  module MD5Filter
    def md5(input)
      Digest::MD5.hexdigest(input.to_s)
    end
  end
end

Liquid::Template.register_filter(Jekyll::MD5Filter)